// YoDesi.net Nuvio provider — resolves Indian TV episodes from yodesi.net
// through tvcine.me player pages.
//
// Post page (plain HTML) links out to tvcine.me/player.php?id={n} (4 ids per
// post, all resolving to the same underlying Flow stream). player.php is
// static HTML carrying a plain iframe src='https://flow.tvlogy.to/
// {player,nflix}/{flowId}/' (single-quoted) — the 32KB of obfuscated JS on the
// page is anti-bot/ad noise, not the player gate. Flow pages require the
// player.php URL as Referer (403 otherwise); master playlist is
// JuicyCodes-packed (src/lib/flow.js).
//
// Post slugs: /{show}-{ordinal}-{fullmonth}-{year}-watch-online/
// Search: WordPress ?s= works; site keeps post history.

import { TMDB_API_KEY, BROWSER_HEADERS } from "../lib/constants.js";
import { resolveFetch, fetchFirstResult } from "../lib/http.js";
import { dedupe, dedupeStreams, links } from "../lib/html.js";
import { buildMediaRequest } from "../lib/tmdb.js";
import { episodePostCandidates } from "../lib/episodes.js";
import { resolveFlowPlayer } from "../lib/flow.js";
import { toNuvioStream } from "../lib/format.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://www.yodesi.net";
var SEARCH_PATH = "/?s=";
var SITE_HOST_RE = /^https:\/\/(?:www\.)?yodesi\.net\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$|\/(about|contact|dmca|privacy|terms|alt-balaji|amazon)\/?$/i;
var PLAYER_LINK_RE = /(?:href=["'])?(https?:\/\/(?:www\.)?tvcine\.me\/player\.php\?id=\d+)/gi;
var FLOW_IFRAME_RE = /src=['"](https?:\/\/flow\.tvlogy\.to\/[A-Za-z0-9/_-]+\/?)['"]/i;

// ---------------------------------------------------------------------------
// Layer 2: Episode page discovery
// ---------------------------------------------------------------------------

function buildSearchUrls(request) {
  return (request.slugCandidates || []).slice(0, 3).map(function (slug) {
    return SITE_BASE + SEARCH_PATH + encodeURIComponent(slug.replace(/-/g, " ")).replace(/%20/g, "+");
  });
}

function episodePageCandidates(markup, request) {
  return episodePostCandidates(links(markup), request, SITE_HOST_RE, NON_POST_RE);
}

// ---------------------------------------------------------------------------
// Layer 3: player.php links -> flow iframes
// ---------------------------------------------------------------------------

function findPlayerLinks(markup) {
  var urls = [];
  var re = new RegExp(PLAYER_LINK_RE.source, "gi");
  var m;
  while ((m = re.exec(markup)) !== null) {
    urls.push(m[1]);
  }
  return dedupe(urls).slice(0, 4);
}

function findPlayersFromPages(fetchImpl, urls) {
  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (page) {
    var players = findPlayerLinks(page);
    return players.length > 0 ? players : null;
  }).then(function (players) {
    return players || [];
  });
}

// Each player.php embeds a flow iframe; dedupe by flow id after resolving
// the iframe src (player/nflix skins share the same flowId).
function extractFlowUrls(fetchImpl, playerUrls) {
  return Promise.all(playerUrls.map(function (playerUrl) {
    return fetchImpl(playerUrl, { headers: { Referer: SITE_BASE + "/", "User-Agent": BROWSER_HEADERS["User-Agent"] } })
      .then(function (res) { return res ? res.text() : null; })
      .then(function (page) {
        if (!page) return null;
        var m = page.match(FLOW_IFRAME_RE);
        return m ? { url: m[1], referer: playerUrl } : null;
      })
      .catch(function () { return null; });
  })).then(function (entries) {
    var seen = {};
    return entries.filter(function (e) {
      if (!e) return false;
      var id = e.url.replace(/\/+$/, "").split("/").pop();
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  });
}

// ---------------------------------------------------------------------------
// Layer 4 + 5: Resolution + entry point
// ---------------------------------------------------------------------------

function resolveYoDesi(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return fetchFirstResult(fetchImpl, buildSearchUrls(request), { headers: BROWSER_HEADERS }, function (page) {
    var episodeUrls = episodePageCandidates(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function (episodeUrls) {
    if (!episodeUrls) return [];
    return findPlayersFromPages(fetchImpl, episodeUrls).then(function (playerUrls) {
      return extractFlowUrls(fetchImpl, playerUrls).then(function (flows) {
        return Promise.all(flows.map(function (entry) {
          return resolveFlowPlayer(entry.url, entry.referer, { fetchImpl: fetchImpl })
            .catch(function (error) {
              console.log("[YoDesi] flow failed for " + entry.url + ": " + (error && error.message));
              return null;
            });
        })).then(function (streams) {
          return streams.filter(function (s) { return s !== null; });
        });
      });
    });
  });
}

function getStreamsForRequest(request, options) {
  return resolveYoDesi(request, options)
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "YoDesi Flow" + (stream.sourceTag ? " (" + stream.sourceTag + ")" : "");
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[YoDesi] resolver failed: " + error.message);
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") return Promise.resolve([]);
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[YoDesi] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
