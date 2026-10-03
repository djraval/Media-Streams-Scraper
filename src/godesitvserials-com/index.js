// GoDesiTVSerials Nuvio provider — resolves Indian TV episodes from
// godesitvserials.com. Posts use one of two embed styles (varies by show):
//
//   A) blogspot player iframe (static src):
//        godesiserials.blogspot.com/p/player.html?slug={ep-slug}
//      → GET {SITE_BASE}/api/token.php?slug={ep-slug} → {source, token}
//      → megaplays: https://proxy.megaplays.se/?t={token} (direct MP4)
//        yandex:    https://streaming.disk.yandex.net/hls/{token} (HLS)
//
//   B) dramavideo data-a/data-b base64 halves → dramavideo.se/watch?v={id}
//      → resolved via lib/dramavideo.js (AES-CBC decrypt → HLS)
//
// Chain is fully text-fetchable — no JS execution or packer decoding needed
// upstream of the dramavideo AES step.

import { TMDB_API_KEY, UA, BROWSER_HEADERS } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchFirstResult, fetchJson, fetchContentLength } from "../lib/http.js";
import { dedupe, dedupeStreams, links } from "../lib/html.js";
import { buildMediaRequest, episodeDateSlug } from "../lib/tmdb.js";
import { episodePostCandidates } from "../lib/episodes.js";
import { toNuvioStream, formatBytes, sortStreamsBest } from "../lib/format.js";
import {
  dramavideoWatchUrlFromMarkup,
  resolveDramavideoWatch,
} from "../lib/dramavideo.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://godesitvserials.com";
var SEARCH_PATH = "/?s=";
var TOKEN_API = SITE_BASE + "/api/token.php";
var PLAYER_HOST = "godesiserials.blogspot.com";

var SITE_HOST_RE = /^https:\/\/(?:www\.)?godesitvserials\.com\//i;
var PLAYER_SLUG_RE = /godesiserials\.blogspot\.com\/p\/player\.html\?slug=([A-Za-z0-9-]+)/i;
var CATEGORY_RE = /\/category\//i;

// ---------------------------------------------------------------------------
// Layer 2: Site search + episode page discovery
// ---------------------------------------------------------------------------

function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  var slugs = (request.slugCandidates || []).slice(0, 2);
  var urls = [];
  for (var i = 0; i < slugs.length; i++) {
    if (dateSlug) {
      urls.push(
        SITE_BASE + SEARCH_PATH +
          encodeURIComponent(slugs[i] + " " + dateSlug.replace(/-/g, " ")).replace(/%20/g, "+"),
      );
    }
    urls.push(
      SITE_BASE + SEARCH_PATH +
        encodeURIComponent(slugs[i].replace(/-/g, " ")).replace(/%20/g, "+"),
    );
  }
  return dedupe(urls);
}

function episodePageCandidates(markup, request) {
  return episodePostCandidates(links(markup), request, SITE_HOST_RE, CATEGORY_RE);
}

// ---------------------------------------------------------------------------
// Layer 3 + 4: post → blogspot slug → token API → stream URL
// ---------------------------------------------------------------------------

function playerSlugFromPost(markup) {
  var m = String(markup || "").match(PLAYER_SLUG_RE);
  return m ? m[1] : "";
}

// Maps a token-API source name to a playable stream descriptor.
// Returns null for players that need obfuscated-JS resolvers.
function streamForToken(source, token, referer) {
  var headers = { "User-Agent": UA, Referer: referer };
  switch (String(source || "megaplays").toLowerCase()) {
    case "megaplays":
      return {
        backend: "megaplays",
        kind: "mp4",
        url: "https://proxy.megaplays.se/?t=" + token,
        headers: headers,
      };
    case "yandex":
      return {
        backend: "yandex",
        kind: "hls",
        url: "https://streaming.disk.yandex.net/hls/" + token,
        headers: headers,
      };
    default:
      return null;
  }
}

function resolveViaTokenApi(fetchImpl, slug, postUrl) {
  return fetchJson(fetchImpl, TOKEN_API + "?slug=" + encodeURIComponent(slug))
    .then(function (data) {
      if (!data || !data.token) return null;
      var stream = streamForToken(data.source, data.token, postUrl);
      if (!stream) {
        console.log(
          "[GoDesiTVSerials] unsupported token source '" + data.source + "' for " + postUrl,
        );
        return null;
      }
      stream.size = "";
      stream.sizeBytes = 0;
      if (stream.kind === "mp4") {
        return fetchContentLength(fetchImpl, stream.url, stream.headers).then(
          function (sizeBytes) {
            stream.size = formatBytes(sizeBytes);
            stream.sizeBytes = sizeBytes;
            return stream;
          },
        );
      }
      return stream;
    });
}

function resolveViaDramavideo(fetchImpl, post, postUrl) {
  var watchUrl = dramavideoWatchUrlFromMarkup(post);
  if (!watchUrl) return Promise.resolve([]);
  return resolveDramavideoWatch(fetchImpl, watchUrl, postUrl).then(function (streams) {
    return streams.map(function (s) {
      s.size = "";
      s.sizeBytes = 0;
      return s;
    });
  });
}

function resolveEpisodeUrl(fetchImpl, postUrl) {
  return fetchText(fetchImpl, postUrl, { headers: BROWSER_HEADERS })
    .then(function (post) {
      if (!post) return [];
      var jobs = [];
      var slug = playerSlugFromPost(post);
      if (slug) {
        jobs.push(resolveViaTokenApi(fetchImpl, slug, postUrl));
      }
      jobs.push(resolveViaDramavideo(fetchImpl, post, postUrl));
      if (jobs.length === 0) return [];
      return Promise.all(jobs).then(function (resolved) {
        var streams = [];
        resolved.forEach(function (r) {
          if (!r) return;
          if (Array.isArray(r)) {
            r.forEach(function (s) { if (s) streams.push(s); });
          } else {
            streams.push(r);
          }
        });
        return streams;
      });
    })
    .catch(function (e) {
      console.log("[GoDesiTVSerials] resolve failed for " + postUrl + ": " + (e && e.message));
      return [];
    });
}

function resolveFromEpisodeUrls(fetchImpl, episodeUrls) {
  if (episodeUrls.length === 0) {
    return Promise.resolve([]);
  }
  return Promise.all(
    episodeUrls.map(function (url) {
      return resolveEpisodeUrl(fetchImpl, url);
    }),
  ).then(function (resolved) {
    var all = [];
    resolved.forEach(function (set) {
      if (Array.isArray(set)) {
        set.forEach(function (s) { if (s) all.push(s); });
      } else if (set) {
        all.push(set);
      }
    });
    return dedupeStreams(all);
  });
}

function resolveGoDesi(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var searchUrls = buildSearchUrls(request);
  if (searchUrls.length === 0) {
    return Promise.resolve([]);
  }
  return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function (page) {
    var episodeUrls = episodePageCandidates(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function (episodeUrls) {
    if (!episodeUrls) return [];
    return resolveFromEpisodeUrls(fetchImpl, episodeUrls);
  });
}

// ---------------------------------------------------------------------------
// Layer 5 + 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  return resolveGoDesi(request, options)
    .then(function (resolved) {
      return sortStreamsBest(dedupeStreams(resolved), request.runtimeMinutes).map(function (stream) {
        stream.name = "GoDesiTVSerials " + stream.backend;
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[GoDesiTVSerials] resolver failed: " + error.message);
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
      console.log("[GoDesiTVSerials] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
