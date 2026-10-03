// DesiTellyBox.to Nuvio provider — resolves Indian TV episodes from
// desitellybox.to through ad-hop landing pages (business-credits.cc,
// credits-loan.pw, ... — domains rotate; matched by path pattern).
//
// Post page (plain HTML) links:
//   {hop}/media.php?id={n}   → IFRAME SRC="flow.tvlogy.to/{player,plyr}/{id}/"
//   {hop}/flix.php?url={t}   → IFRAME SRC="flow.tvlogy.to/nflix/{id}/"
//   {hop}/media.php?id={n}   → vkspeed.com/embed-{id}-WxH.html in body text
// Post slugs: {show}-{ordinal}-{month}-{year}-watch-online/{postid}/

import { TMDB_API_KEY, BROWSER_HEADERS, VKSPEED_HOSTS, VKPRIME_HOSTS } from "../lib/constants.js";
import { resolveFetch, fetchFirstResult, fetchContentLength } from "../lib/http.js";
import { dedupe, dedupeStreams, isPlaceholderUrl, embedHostRegex, links, resolveRelativeUrl } from "../lib/html.js";
import { buildMediaRequest, episodeDateSlug } from "../lib/tmdb.js";
import { episodePostCandidates } from "../lib/episodes.js";
import { resolveVkPlayer } from "../lib/vkplayer.js";
import { resolveFlowPlayer } from "../lib/flow.js";
import { toNuvioStream, formatBytes } from "../lib/format.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://www.desitellybox.to";
var SEARCH_PATH = "/?s=";
var SITE_HOST_RE = /^https:\/\/(?:www\.)?desitellybox\.to\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$|\/(about-us|contact|dmca|privacy-policy|terms)/i;
var VKPRIME_RE = embedHostRegex(VKPRIME_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var VKSPEED_RE = embedHostRegex(VKSPEED_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var FLOW_RE = /flow\.tvlogy\.to\/[A-Za-z0-9/_-]+\/?/i;
// Hop links inside posts — host rotates, path is stable.
var HOP_RE = /href="(https?:\/\/(?!www\.desitellybox)[^"']*\/(?:media|flix)\.php\?[^"']+)"/gi;

function displayBackend(backend) {
  return String(backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, function (_match, prefix, ch) { return prefix + ch.toUpperCase(); })
    .replace(/[-_]+/g, "");
}

// ---------------------------------------------------------------------------
// Layer 2: Episode page discovery
// ---------------------------------------------------------------------------

function siteSlugCandidates(request) {
  var candidates = request.slugCandidates || [];
  return dedupe(candidates.map(function (slug) {
    return slug.replace(/-s(?=-|$)/g, "s");
  }).concat(candidates));
}

function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  var urls = siteSlugCandidates(request).slice(0, 2).map(function (slug) {
    return SITE_BASE + SEARCH_PATH + encodeURIComponent(slug.replace(/-/g, " ")).replace(/%20/g, "+");
  });
  if (dateSlug) {
    var dateQuery = dateSlug.replace(/-/g, " ");
    urls = siteSlugCandidates(request).slice(0, 2).map(function (slug) {
      return SITE_BASE + SEARCH_PATH + encodeURIComponent(slug + " " + dateQuery).replace(/%20/g, "+");
    }).concat(urls);
  }
  return dedupe(urls);
}

function episodePageCandidates(markup, request) {
  return episodePostCandidates(links(markup), request, SITE_HOST_RE, NON_POST_RE);
}

// ---------------------------------------------------------------------------
// Layer 3: Hop extraction → real player URLs
// ---------------------------------------------------------------------------

function findHopUrls(markup) {
  var hops = [];
  var m;
  var re = new RegExp(HOP_RE.source, "gi");
  while ((m = re.exec(markup)) !== null) {
    hops.push(m[1]);
  }
  return dedupe(hops);
}

// A hop page is a thin ad shell that contains the real player URL in
// uppercase IFRAME SRC or inline body text. Returns {url, referer} — the
// referer is the hop page itself, which downstream players (flow.tvlogy.to)
// require (they 403 on the post URL or no referer).
function extractPlayerFromHop(page, hopUrl) {
  var players = [];
  var push = function (url) {
    if (url) players.push({ url: url, referer: hopUrl });
  };
  // Scan every src/SRC= in the page — the first is often a jquery/ad script;
  // keep only known player hosts.
  var srcs = page.match(/(?:SRC|src)="(https?:\/\/[^"]{10,160})"/g) || [];
  srcs.forEach(function (tag) {
    var url = tag.replace(/^(?:SRC|src)="/i, "").replace(/"$/, "");
    if (VKSPEED_RE.test(url) || VKPRIME_RE.test(url) || FLOW_RE.test(url)) {
      push(url);
    }
  });
  var vk = page.match(/vkspeed\.com\/embed-[A-Za-z0-9-]+\.html/i);
  if (vk) push("https://" + vk[0]);
  var vp = page.match(/vkprime\.com\/embed-[A-Za-z0-9-]+\.html/i);
  if (vp) push("https://" + vp[0]);
  var seen = {};
  return players.filter(function (p) {
    if (seen[p.url]) return false;
    seen[p.url] = true;
    return true;
  });
}

function resolveHops(fetchImpl, hopUrls, referer) {
  return Promise.all(hopUrls.map(function (hopUrl) {
    return fetchImpl(hopUrl, { headers: { Referer: referer, "User-Agent": BROWSER_HEADERS["User-Agent"] } })
      .then(function (res) { return res ? res.text() : null; })
      .then(function (page) { return page ? extractPlayerFromHop(page, hopUrl) : []; })
      .catch(function () { return []; });
  })).then(function (groups) {
    var seen = {};
    return groups.reduce(function (acc, g) { return acc.concat(g); }, []).filter(function (p) {
      if (seen[p.url]) return false;
      seen[p.url] = true;
      return true;
    });
  });
}

function findPlayersFromPages(fetchImpl, urls) {
  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (page) {
    var hops = findHopUrls(page);
    return hops.length > 0 ? hops : null;
  }).then(function (hops) {
    if (!hops) return [];
    return resolveHops(fetchImpl, hops.slice(0, 6), urls[0] || SITE_BASE + "/");
  });
}

// ---------------------------------------------------------------------------
// Layer 4: Player resolution
// ---------------------------------------------------------------------------

function resolvePlayers(fetchImpl, players, fallbackReferer) {
  return Promise.all(players.map(function (entry) {
    var playerUrl = entry.url;
    var referer = entry.referer || fallbackReferer;
    if (FLOW_RE.test(playerUrl)) {
      return resolveFlowPlayer(playerUrl, referer, { fetchImpl: fetchImpl })
        .catch(function (error) {
          console.log("[DesiTellyBox] flow failed for " + playerUrl + ": " + (error && error.message));
          return null;
        });
    }
    if (VKSPEED_RE.test(playerUrl) || VKPRIME_RE.test(playerUrl)) {
      var backend = playerUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
      return resolveVkPlayer(playerUrl, referer, { fetchImpl: fetchImpl })
        .then(function (sources) {
          var real = (sources || []).filter(function (source) {
            return !isPlaceholderUrl(source.url);
          });
          if (real.length === 0) return null;
          var best = real[0];
          var stream = {
            backend: backend,
            kind: "mp4",
            quality: best.quality || "unknown",
            url: best.url,
            size: "",
            sizeBytes: 0,
            sourceTag: "",
            headers: best.headers,
          };
          return fetchContentLength(fetchImpl, best.url, best.headers).then(function (sizeBytes) {
            stream.size = formatBytes(sizeBytes);
            stream.sizeBytes = sizeBytes;
            return stream;
          });
        })
        .catch(function (error) {
          console.log("[DesiTellyBox] vk failed for " + playerUrl + ": " + (error && error.message));
          return null;
        });
    }
    return Promise.resolve(null);
  })).then(function (resolved) {
    return dedupeStreams(resolved);
  });
}

function resolveDesiTellyBox(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return fetchFirstResult(fetchImpl, buildSearchUrls(request), { headers: BROWSER_HEADERS }, function (page) {
    var episodeUrls = episodePageCandidates(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function (episodeUrls) {
    if (!episodeUrls) return [];
    return findPlayersFromPages(fetchImpl, episodeUrls).then(function (players) {
      return resolvePlayers(fetchImpl, players, episodeUrls[0] || SITE_BASE + "/");
    });
  });
}

// ---------------------------------------------------------------------------
// Layer 5 + Layer 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  return resolveDesiTellyBox(request, options)
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "DesiTellyBox " + displayBackend(stream.backend) + (stream.sourceTag ? " (" + stream.sourceTag + ")" : "");
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[DesiTellyBox] resolver failed: " + error.message);
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
      console.log("[DesiTellyBox] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
