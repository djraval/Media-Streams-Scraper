// VidUp Desi Nuvio provider — resolves Indian TV episodes from
// yodesionline.net and desiserialonline.su via vidup.site (Blogger video) player.
//
// Both sites use WordPress with date-based episode URLs:
//   yodesionline.net:      /{slug}-{date}-full-episode-{num}/
//   desiserialonline.su:   /{slug}-{date}-video-episode-{num}/
//
// The date format is "11th-july-2026" (produced by episodeDateSlug).

import { UA, BROWSER_HEADERS, TMDB_API_KEY } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchFirstResult } from "../lib/http.js";
import { iframeSrcCandidates, dedupe, dedupeStreams } from "../lib/html.js";
import { buildMediaRequest, slugCandidates, episodeDateSlug } from "../lib/tmdb.js";
import { toNuvioStream } from "../lib/format.js";
import { resolveVidUpEmbed, isVidUpUrl } from "../lib/vidup.js";

// ---------------------------------------------------------------------------
// Layer 0: Configuration
// ---------------------------------------------------------------------------

var SITES = [
  {
    base: "https://yodesionline.net",
    episodePatterns: [
      "/{slug}-{date}-full-episode-{num}/",
    ],
  },
  {
    base: "https://desiserialonline.su",
    episodePatterns: [
      "/{slug}-{date}-video-episode-{num}/",
    ],
  },
];

// WordPress search path for fallback when air date is missing.
var SEARCH_PATH = "/?s=";

// ---------------------------------------------------------------------------
// Layer 2: Episode page URL construction
// ---------------------------------------------------------------------------

// Build candidate episode URLs for a given site, slug, date, and episode number.
function buildEpisodeUrls(site, slugCandidates, dateSlug, episodeNum) {
  var urls = [];
  for (var s = 0; s < slugCandidates.length; s++) {
    for (var p = 0; p < site.episodePatterns.length; p++) {
      var path = site.episodePatterns[p]
        .replace("{slug}", slugCandidates[s])
        .replace("{date}", dateSlug)
        .replace("{num}", episodeNum);
      urls.push(site.base + path);
    }
  }
  return urls;
}

// Build all candidate URLs across all sites.
function buildAllEpisodeUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) return [];

  var allUrls = [];
  for (var i = 0; i < SITES.length; i++) {
    var siteUrls = buildEpisodeUrls(SITES[i], request.slugCandidates, dateSlug, request.episode);
    allUrls = allUrls.concat(siteUrls);
  }
  return allUrls;
}

// Build WordPress search URLs as fallback.
function buildSearchUrls(request) {
  var urls = [];
  var query = encodeURIComponent(request.title + " episode " + request.episode);
  for (var i = 0; i < SITES.length; i++) {
    urls.push(SITES[i].base + SEARCH_PATH + query);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Layer 3: Embed URL extraction
// ---------------------------------------------------------------------------

// Extract vidup.site iframe URLs from an episode page HTML.
function extractVidUpEmbeds(html) {
  var candidates = iframeSrcCandidates(html);
  return dedupe(candidates.filter(isVidUpUrl));
}

// Find episode links from a WordPress search results page.
function extractEpisodeLinks(html, episodeNum) {
  var linkRe = /href="(https?:\/\/[^"]+\/[^"]*episode[^"]*)"/gi;
  var match;
  var urls = [];
  while ((match = linkRe.exec(String(html || ""))) !== null) {
    var url = match[1];
    // Match episode number in the URL
    if (url.match(new RegExp("episode-" + episodeNum + "\\b"))) {
      urls.push(url);
    }
  }
  return dedupe(urls);
}

// ---------------------------------------------------------------------------
// Layer 4: Player resolution
// ---------------------------------------------------------------------------

// Resolve all vidup.site embeds from a list of embed URLs.
function resolveAllEmbeds(fetchImpl, embeds) {
  return Promise.all(embeds.map(function (embedUrl) {
    return resolveVidUpEmbed(fetchImpl, embedUrl);
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
  var urls = buildAllEpisodeUrls(request);

  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (html) {
    var embeds = extractVidUpEmbeds(html);
    if (embeds.length === 0) return null;
    return embeds;
  })
    .then(function (embeds) {
      if (embeds) {
        return resolveAllEmbeds(fetchImpl, embeds);
      }

      // Fallback: WordPress search
      var searchUrls = buildSearchUrls(request);
      return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function (html) {
        var episodeLinks = extractEpisodeLinks(html, request.episode);
        return episodeLinks.length > 0 ? episodeLinks : null;
      }).then(function (links) {
        if (!links || links.length === 0) return [];
        return fetchFirstResult(fetchImpl, links, { headers: BROWSER_HEADERS }, function (html) {
          var embeds = extractVidUpEmbeds(html);
          return embeds.length > 0 ? embeds : null;
        }).then(function (searchEmbeds) {
          if (!searchEmbeds) return [];
          return resolveAllEmbeds(fetchImpl, searchEmbeds);
        });
      });
    })
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "VidUp Desi";
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[VidUp Desi] resolver failed: " + error.message);
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
      console.log("[VidUp Desi] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
