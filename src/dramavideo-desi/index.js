// DramaVideo Desi Nuvio provider — resolves Indian TV episodes from
// yehrishtakiakehlatahai.com via dramavideo.se (AES-CBC encrypted HLS) player.
//
// Episode URL pattern: /{slug}-{date}-episode-{num}-video/
// The date format is "16th-june-2026" (produced by episodeDateSlug).

import { UA, BROWSER_HEADERS, TMDB_API_KEY } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchFirstResult } from "../lib/http.js";
import { iframeSrcCandidates, dedupe, dedupeStreams } from "../lib/html.js";
import { buildMediaRequest, slugCandidates, episodeDateSlug } from "../lib/tmdb.js";
import { toNuvioStream } from "../lib/format.js";
import { resolveDramavideoEmbed, isDramavideoUrl } from "../lib/dramavideo.js";

// ---------------------------------------------------------------------------
// Layer 0: Configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://yehrishtakiakehlatahai.com";
var EPISODE_PATTERN = "/{slug}-{date}-episode-{num}-video/";
var SEARCH_PATH = "/?s=";

// ---------------------------------------------------------------------------
// Layer 2: Episode page URL construction
// ---------------------------------------------------------------------------

// Build candidate episode URLs using date-based construction.
function buildEpisodeUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) return [];

  var urls = [];
  for (var i = 0; i < request.slugCandidates.length; i++) {
    var path = EPISODE_PATTERN
      .replace("{slug}", request.slugCandidates[i])
      .replace("{date}", dateSlug)
      .replace("{num}", request.episode);
    urls.push(SITE_BASE + path);
  }
  return urls;
}

// Build WordPress search URL as fallback.
function buildSearchUrl(request) {
  var query = encodeURIComponent(request.title + " episode " + request.episode);
  return SITE_BASE + SEARCH_PATH + query;
}

// ---------------------------------------------------------------------------
// Layer 3: Embed URL extraction
// ---------------------------------------------------------------------------

// Extract dramavideo.se/watch iframe URLs from an episode page HTML.
function extractDramavideoEmbeds(html) {
  var candidates = iframeSrcCandidates(html);
  return dedupe(candidates.filter(isDramavideoUrl));
}

// Find episode links from a WordPress search results page.
function extractEpisodeLinks(html, episodeNum) {
  var linkRe = /href="(https?:\/\/yehrishtakiakehlatahai\.com\/[^"]*episode[^"]*)"/gi;
  var match;
  var urls = [];
  while ((match = linkRe.exec(String(html || ""))) !== null) {
    var url = match[1];
    if (url.match(new RegExp("episode-" + episodeNum + "\\b"))) {
      urls.push(url);
    }
  }
  return dedupe(urls);
}

// ---------------------------------------------------------------------------
// Layer 4: Player resolution
// ---------------------------------------------------------------------------

// Resolve all dramavideo.se embeds from a list of embed URLs.
function resolveAllEmbeds(fetchImpl, embeds) {
  return Promise.all(embeds.map(function (embedUrl) {
    return resolveDramavideoEmbed(fetchImpl, embedUrl);
  })).then(function (results) {
    var all = [];
    for (var i = 0; i < results.length; i++) {
      all = all.concat(results[i]);
    }
    return all;
  });
}

// ---------------------------------------------------------------------------
// Layer 5 + 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);

  // Try date-based URL construction first
  var urls = buildEpisodeUrls(request);

  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (html) {
    var embeds = extractDramavideoEmbeds(html);
    if (embeds.length === 0) return null;
    return embeds;
  })
    .then(function (embeds) {
      if (embeds) {
        return resolveAllEmbeds(fetchImpl, embeds);
      }

      // Fallback: WordPress search
      var searchUrl = buildSearchUrl(request);
      return fetchText(fetchImpl, searchUrl, { headers: BROWSER_HEADERS })
        .then(function (html) {
          if (!html) return [];
          var episodeLinks = extractEpisodeLinks(html, request.episode);
          if (episodeLinks.length === 0) return [];

          return fetchFirstResult(fetchImpl, episodeLinks, { headers: BROWSER_HEADERS }, function (epHtml) {
            var searchEmbeds = extractDramavideoEmbeds(epHtml);
            return searchEmbeds.length > 0 ? searchEmbeds : null;
          }).then(function (searchEmbeds) {
            if (!searchEmbeds) return [];
            return resolveAllEmbeds(fetchImpl, searchEmbeds);
          });
        });
    })
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "DramaVideo Desi";
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[DramaVideo Desi] resolver failed: " + error.message);
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[DramaVideo Desi] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
