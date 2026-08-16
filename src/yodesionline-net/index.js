// YoDesiOnline.net Nuvio provider — resolves Indian TV episodes from
// yodesionline.net via VkPrime/VkSpeed (MP4) players.

import { TMDB_API_KEY, BROWSER_HEADERS, VKSPEED_HOSTS, VKPRIME_HOSTS } from "../lib/constants.js";
import { resolveFetch, fetchFirstResult, fetchContentLength } from "../lib/http.js";
import { dedupe, dedupeStreams, isPlaceholderUrl, embedHostRegex, links, iframeSrcCandidates } from "../lib/html.js";
import { buildMediaRequest, episodeDateSlug } from "../lib/tmdb.js";
import { resolveVkPlayer } from "../lib/vkplayer.js";
import { toNuvioStream, formatBytes } from "../lib/format.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://yodesionline.net";
var SEARCH_PATH = "/?s=";
var SITE_HOST_RE = /^https:\/\/(?:www\.)?yodesionline\.net\//i;
var VKPRIME_RE = embedHostRegex(VKPRIME_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var VKSPEED_RE = embedHostRegex(VKSPEED_HOSTS, "embed-[A-Za-z0-9-]+\\.html");

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
  // WordPress drops apostrophes instead of turning them into separators.
  return dedupe(candidates.map(function (slug) {
    return slug.replace(/-s(?=-|$)/g, "s");
  }).concat(candidates));
}

function buildEpisodeUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) return [];
  return siteSlugCandidates(request).map(function (slug) {
    return SITE_BASE + "/" + slug + "-" + dateSlug + "-full-episode/";
  });
}

function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) return [];
  var dateQuery = dateSlug.replace(/-/g, " ");
  return siteSlugCandidates(request).slice(0, 2).map(function (slug) {
    return SITE_BASE + SEARCH_PATH + encodeURIComponent(slug + " " + dateQuery).replace(/%20/g, "+");
  });
}

function episodePageCandidates(markup, request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) return [];
  return dedupe(links(markup).filter(function (href) {
    if (!SITE_HOST_RE.test(href) || href.toLowerCase().indexOf(dateSlug) === -1) {
      return false;
    }
    return siteSlugCandidates(request).some(function (slug) {
      return href.toLowerCase().indexOf(slug) !== -1;
    });
  }));
}

// ---------------------------------------------------------------------------
// Layer 3: Vk player extraction
// ---------------------------------------------------------------------------

function findPlayerIframes(markup) {
  return dedupe(iframeSrcCandidates(markup).filter(function (href) {
    return VKPRIME_RE.test(href) || VKSPEED_RE.test(href);
  }));
}

function findEmbedsFromPages(fetchImpl, urls) {
  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (page) {
    var embeds = findPlayerIframes(page);
    return embeds.length > 0 ? embeds : null;
  });
}

// ---------------------------------------------------------------------------
// Layer 4: Vk player resolution
// ---------------------------------------------------------------------------

function resolveEmbeds(fetchImpl, iframeUrls) {
  if (!iframeUrls || iframeUrls.length === 0) return Promise.resolve([]);
  return Promise.all(iframeUrls.map(function (iframeUrl) {
    var backend = iframeUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
    return resolveVkPlayer(iframeUrl, SITE_BASE + "/", { fetchImpl: fetchImpl })
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
        console.log("[YoDesiOnline.net] player resolution failed for " + iframeUrl + ": " + (error && error.message));
        return null;
      });
  })).then(function (resolved) {
    return dedupeStreams(resolved);
  });
}

function resolveYoDesiOnline(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return findEmbedsFromPages(fetchImpl, buildEpisodeUrls(request))
    .then(function (embeds) {
      if (embeds) return resolveEmbeds(fetchImpl, embeds);
      return fetchFirstResult(fetchImpl, buildSearchUrls(request), { headers: BROWSER_HEADERS }, function (page) {
        var episodeUrls = episodePageCandidates(page, request);
        return episodeUrls.length > 0 ? episodeUrls : null;
      }).then(function (episodeUrls) {
        if (!episodeUrls) return [];
        return findEmbedsFromPages(fetchImpl, episodeUrls).then(function (searchEmbeds) {
          return searchEmbeds ? resolveEmbeds(fetchImpl, searchEmbeds) : [];
        });
      });
    });
}

// ---------------------------------------------------------------------------
// Layer 5 + Layer 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  return resolveYoDesiOnline(request, options)
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "YoDesiOnline.net " + displayBackend(stream.backend);
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[YoDesiOnline.net] resolver failed: " + error.message);
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
      console.log("[YoDesiOnline.net] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
