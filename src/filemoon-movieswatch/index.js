// FileMoon MoviesWatchHD Nuvio provider — resolves Bollywood/Hindi movies from
// movieswatchhd.com via FileMoon (AES-256-GCM encrypted HLS) player.
// FileMoon API at /api/videos/{code} returns encrypted playback data.
// Decryption uses crypto.subtle AES-256-GCM (Web Crypto API, available in Nuvio).

import { BROWSER_HEADERS, UA } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchFirstResult } from "../lib/http.js";
import { dedupe, dedupeStreams, links, iframeSrcCandidates } from "../lib/html.js";
import { buildMediaRequest, slugCandidates } from "../lib/tmdb.js";
import { resolveFileMoon, isFileMoonUrl, extractFileMoonCode } from "../lib/filemoon.js";
import { toNuvioStream } from "../lib/format.js";

var SITE_BASE = "https://www.movieswatchhd.com";

// ---------------------------------------------------------------------------
// Search + movie page discovery
// ---------------------------------------------------------------------------

// Build search URL for movieswatchhd.com.
// Search pattern: https://www.movieswatchhd.com/search?search={query}
function buildSearchUrls(request) {
  var slugs = slugCandidates(request.title);
  var queries = [];

  // Primary: full title
  queries.push(request.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());

  // Slug variants without hyphens (search uses spaces)
  for (var i = 0; i < slugs.length; i++) {
    queries.push(slugs[i].replace(/-/g, " "));
  }

  // Title + year (helps narrow results)
  if (request.airYear) {
    queries.push(request.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " " + request.airYear);
  }

  queries = dedupe(queries);
  var urls = [];
  for (var j = 0; j < queries.length; j++) {
    urls.push(SITE_BASE + "/search?search=" + encodeURIComponent(queries[j]));
  }
  return urls;
}

// Extract movie watch-page URLs from search results HTML.
// Movie cards: <a class="video-icon" href="https://www.movieswatchhd.com/watch-video/{id}">
function extractWatchPageUrls(html) {
  var urlRegex = /href="(https?:\/\/(?:www\.)?movieswatchhd\.com\/watch-video\/\d+)"/gi;
  var matches = String(html || "").match(urlRegex) || [];
  var urls = [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i].match(/href="([^"]+)"/);
    if (m) urls.push(m[1]);
  }
  return dedupe(urls);
}

// Extract movie title from watch page HTML.
function extractMovieTitle(html) {
  var h1Match = String(html || "").match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) {
    // Clean up: "Watch Jolly LLB 3 (2025) Hindi Stream Online And Free Download In HD 1080p"
    var title = h1Match[1].replace(/^Watch\s+/i, "").replace(/\s+Stream\s+Online.*$/i, "").replace(/\s+Free\s+Download.*$/i, "").trim();
    return title;
  }
  var titleMatch = String(html || "").match(/<title>[^<]*Watch\s+([^<]+?)\s+(?:Hindi|Stream|Online|Free|Download|HD)/i);
  if (titleMatch) return titleMatch[1].trim();
  return "";
}

// Check if movie title matches the request.
function titleMatches(pageTitle, requestTitle) {
  var p = pageTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
  var r = requestTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!p || !r) return false;
  if (p === r) return true;
  // Partial match (page title may have extra info)
  if (p.indexOf(r) !== -1 || r.indexOf(p) !== -1) return true;
  return false;
}

// ---------------------------------------------------------------------------
// FileMoon embed extraction from watch page
// ---------------------------------------------------------------------------

// Extract FileMoon embed URLs and quality labels from a watch page.
// Returns array of { url, quality }.
function extractFileMoonEmbeds(html) {
  var results = [];
  var str = String(html || "");

  // Pattern 1: iframe src with filemoon embed
  var iframeRegex = /<iframe[^>]*src="(https?:\/\/[^"]*filemoon\.[a-z]+\/e\/[0-9a-zA-Z]+)"/gi;
  var iframeMatches = str.match(iframeRegex) || [];
  for (var i = 0; i < iframeMatches.length; i++) {
    var m = iframeMatches[i].match(/src="([^"]+)"/);
    if (m) {
      results.push({ url: m[1], quality: "" });
    }
  }

  // Pattern 2: <source> tag with filemoon URL
  var sourceRegex = /<source[^>]*src="(https?:\/\/[^"]*filemoon\.[a-z]+\/e\/[0-9a-zA-Z]+)"/gi;
  var sourceMatches = str.match(sourceRegex) || [];
  for (var j = 0; j < sourceMatches.length; j++) {
    var sm = sourceMatches[j].match(/src="([^"]+)"/);
    if (sm) {
      results.push({ url: sm[1], quality: "" });
    }
  }

  // Pattern 3: download links with quality labels
  // <h4 class="px-2">Quality: Filemoon 720</h4> ... <a href="https://filemoon.sx/d/{code}">
  var downloadRegex = /Quality:\s*Filemoon\s*(\d+)/gi;
  var lastIndex = 0;
  var dm;
  while ((dm = downloadRegex.exec(str)) !== null) {
    var quality = dm[1] + "p";
    // Find the next filemoon link after this quality label
    var afterLabel = str.substring(dm.index);
    var linkMatch = afterLabel.match(/href="(https?:\/\/[^"]*filemoon\.[a-z]+\/d\/[0-9a-zA-Z]+)"/i);
    if (linkMatch) {
      // Convert /d/ to /e/ for embed URL
      var embedUrl = linkMatch[1].replace(/\/d\//, "/e/");
      results.push({ url: embedUrl, quality: quality });
    }
  }

  // Dedupe by URL, keeping the one with a quality label
  var seen = {};
  var deduped = [];
  for (var k = 0; k < results.length; k++) {
    var key = results[k].url;
    if (seen[key]) {
      // If existing entry has no quality but this one does, update it
      if (!seen[key].quality && results[k].quality) {
        seen[key].quality = results[k].quality;
      }
    } else {
      seen[key] = results[k];
      deduped.push(results[k]);
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Stream resolution pipeline
// ---------------------------------------------------------------------------

function resolveFromFileMoonPages(fetchImpl, watchUrls, request) {
  if (watchUrls.length === 0) return Promise.resolve([]);

  // Fetch first matching watch page (stop after first with FileMoon embeds)
  return fetchFirstResult(fetchImpl, watchUrls.slice(0, 5), { headers: BROWSER_HEADERS }, function (html) {
    if (!html) return null;
    // Verify title matches
    var pageTitle = extractMovieTitle(html);
    if (pageTitle && request.title && !titleMatches(pageTitle, request.title)) {
      return null;
    }
    var embeds = extractFileMoonEmbeds(html);
    if (embeds.length === 0) return null;
    return embeds;
  }).then(function (embeds) {
    if (!embeds || embeds.length === 0) return [];

    return Promise.all(
      embeds.map(function (embed) {
        return resolveFileMoon(fetchImpl, embed.url, SITE_BASE).then(function (streams) {
          return streams.map(function (s) {
            // Use page quality label if API didn't provide one
            if (!s.quality && embed.quality) {
              s.quality = embed.quality;
            }
            s.sourceTag = "FileMoon";
            return s;
          });
        }).catch(function () { return []; });
      })
    ).then(function (allStreams) {
      // Flatten and dedupe
      var flat = [];
      for (var i = 0; i < allStreams.length; i++) {
        for (var j = 0; j < allStreams[i].length; j++) {
          flat.push(allStreams[i][j]);
        }
      }
      return dedupeStreams(flat);
    });
  });
}

// ---------------------------------------------------------------------------
// getStreams entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);

  // Movies only — movieswatchhd.com doesn't have TV serials
  if (request.mediaType !== "movie") {
    return Promise.resolve([]);
  }

  // Step 1: Search for the movie
  var searchUrls = buildSearchUrls(request);

  return fetchFirstResult(fetchImpl, searchUrls.slice(0, 4), { headers: BROWSER_HEADERS }, function (html) {
    if (!html) return null;
    var watchUrls = extractWatchPageUrls(html);
    return watchUrls.length > 0 ? watchUrls : null;
  }).then(function (watchUrls) {
    if (!watchUrls || watchUrls.length === 0) return [];
    // Step 2: Fetch watch pages and resolve FileMoon embeds
    return resolveFromFileMoonPages(fetchImpl, watchUrls, request);
  }).then(function (resolved) {
    return resolved.map(function (stream) {
      stream.name = "MoviesWatchHD FileMoon";
      if (stream.sourceTag) {
        stream.name += " (" + stream.sourceTag + ")";
      }
      return toNuvioStream(request, stream);
    });
  }).catch(function (error) {
    console.log("[FileMoon MoviesWatchHD] getStreams failed: " + error.message);
    return [];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "movie") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, {})
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[FileMoon MoviesWatchHD] getStreams failed: " + error.message);
      return [];
    });
}

// Dual export pattern for Nuvio sandbox and Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
