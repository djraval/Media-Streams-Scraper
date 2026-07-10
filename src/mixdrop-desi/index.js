// MixDrop Desi Nuvio provider — resolves Indian TV episodes and movies from
// watch-movies.com.pk via MixDrop (MP4) player.
// MixDrop embed pages use Dean Edwards P.A.C.K.E.R. obfuscation; the unpack
// function extracts MDCore.wurl to obtain a direct MP4 URL on *.mxcontent.net.

import { BROWSER_HEADERS, UA } from "../lib/constants.js";
import { resolveFetch, browserHeaders, fetchText, fetchTextTimeout, fetchContentLength } from "../lib/http.js";
import { dedupe, dedupeStreams, links, iframeSrcCandidates } from "../lib/html.js";
import { buildMediaRequest, slugCandidates } from "../lib/tmdb.js";
import { unpack } from "../lib/packer.js";
import { formatBytes, toNuvioStream } from "../lib/format.js";

// MixDrop domains — the site frequently changes its primary domain.
var MIXDROP_DOMAINS = [
  "mixdrop.ag", "mixdrop.to", "mxdrop.to", "mixdrop.ps", "mixdrop.sx",
  "mixdrop.ms", "mixdrop.is", "mixdrop.si", "mixdrop.bz", "mixdrop.nu",
  "mixdrop.sb", "mixdrop.my", "mixdrop.sn", "mixdrop.cv", "mixdrop.top",
  "mixdrop.co", "mixdrop.vc", "mixdrop.club", "m1xdrop.net", "m1xdrop.com",
  "m1xdrop.bz", "m1xdrop.click", "miixdrop.net", "mixdrops.xyz",
  "mixdrop21.net", "mixdrop23.net", "mdy48tn97.com", "mdbekjwqa.pw",
  "mdfx9dc8n.net", "mdzsmutpcvykb.net", "md3b0j6hj.com",
];

var MIXDROP_DOMAIN_RE = new RegExp(
  "(" + MIXDROP_DOMAINS.map(function (d) {
    return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|") + ")",
  "i"
);

var WATCH_MOVIES_HOST_RE = /^https:\/\/www\.watch-movies\.com\.pk\//i;

// watch-movies.com.pk site configuration — the base URL for episode pages.
var WATCH_MOVIES_BASE = "https://www.watch-movies.com.pk/";

// Episode URL suffix templates — {season} is replaced with the season number.
// Add new patterns here when the site changes its URL structure.
var EPISODE_SUFFIXES = [
  "-hindi-season-{season}-watch-online-hd-print-free-download/",
  "-hindi-reality-show-watch-online-hd-print-free-download/",
  "-hindi-dubbed-season-{season}-watch-online-hd-print-free-download/",
];

// Movie URL suffix templates — no season/episode, just the movie title + year.
var MOVIE_SUFFIXES = [
  "-hindi-full-movie-watch-online-hd-print-free-download/",
  "-hindi-dubbed-full-movie-watch-online-hd-print-free-download/",
];

// Episode label prefixes used in URL paths ("ep" and "episode" both appear).
var EPISODE_LABELS = ["ep", "episode"];

// ---------------------------------------------------------------------------
// MixDrop embed resolver — the core reusable function
// ---------------------------------------------------------------------------

// Normalize a MixDrop URL:
//   - Prepend "https:" to protocol-relative URLs (//mxdrop.to/e/...)
//   - Convert /f/ (file page) to /e/ (embed page)
function normalizeMixDropUrl(url) {
  var u = String(url || "").trim();
  if (u.indexOf("//") === 0) {
    u = "https:" + u;
  }
  // Convert file page to embed page
  u = u.replace(/\/f\//, "/e/");
  return u;
}

// Extract the MixDrop file ID from a MixDrop URL.
// e.g., "https://mxdrop.to/e/dk3zrezvudjjz1" → "dk3zrezvudjjz1"
function mixDropId(url) {
  var m = String(url || "").match(/\/(?:e|f)\/([a-z0-9]+)/i);
  return m ? m[1] : "";
}

// Check if a URL is a MixDrop URL (any known domain).
function isMixDropUrl(url) {
  return MIXDROP_DOMAIN_RE.test(String(url || ""));
}

// Detect quality (resolution) from text — looks for patterns like "720p", "1080p", "360p".
function detectQuality(text) {
  var t = String(text || "");
  var match = t.match(/\b(\d{3,4})p\b/i);
  if (match) {
    return match[1] + "p";
  }
  // Check for "HD" without explicit resolution
  if (/\bhd\b/i.test(t)) {
    return "720p";
  }
  if (/\bfull\s*hd\b/i.test(t) || /\bfhd\b/i.test(t)) {
    return "1080p";
  }
  if (/\bsd\b/i.test(t)) {
    return "480p";
  }
  return "unknown";
}

// Resolve a MixDrop embed URL to a direct MP4 stream.
//
// Steps:
//   1. Fetch the embed page (https://mxdrop.to/e/{id})
//   2. Check for "WE ARE SORRY" (dead video)
//   3. Find the eval(function(p,a,c,k,e,d){...}) packer block
//   4. Unpack to get MDCore.wurl
//   5. Prepend "https:" to the "//" URL
//   6. Return a stream object with the direct MP4 URL
//
// Returns a Promise that resolves to a stream object or null.
function resolveMixDrop(embedUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var url = normalizeMixDropUrl(embedUrl);
  var fileId = mixDropId(url);

  return fetchText(fetchImpl, url, browserHeaders(refererUrl))
    .then(function (html) {
      if (!html) {
        console.log("[MixDrop] embed page fetch returned empty for " + url);
        return null;
      }

      // Check for dead video
      if (/WE ARE SORRY/i.test(html) || /can't find the (file|video)/i.test(html)) {
        console.log("[MixDrop] video appears dead/removed for " + url);
        return null;
      }

      // Unpack the Dean Edwards packer
      var unpacked = unpack(html);
      if (!unpacked) {
        console.log("[MixDrop] no packer block found in embed page " + url);
        return null;
      }

      // Extract MDCore.wurl from unpacked code (handle both single and double quotes)
      var wurlMatch = unpacked.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
      if (!wurlMatch) {
        console.log("[MixDrop] MDCore.wurl not found in unpacked code for " + url);
        return null;
      }

      var mp4Url = wurlMatch[1];
      if (!mp4Url) {
        return null;
      }

      // Prepend "https:" to protocol-relative URLs
      if (mp4Url.indexOf("//") === 0) {
        mp4Url = "https:" + mp4Url;
      }

      // Extract filename for quality detection (handle both quote styles)
      var vfileMatch = unpacked.match(/MDCore\.vfile\s*=\s*["']([^"']+)["']/);
      var filename = vfileMatch ? vfileMatch[1] : "";

      // Try to extract poster URL for additional context
      var posterMatch = unpacked.match(/MDCore\.poster\s*=\s*["']([^"']+)["']/);
      var poster = posterMatch ? posterMatch[1] : "";

      // Filename quality is a provisional label; size-based estimation overwrites if it works.
      var quality = detectQuality(filename + " " + poster + " " + mp4Url);

      var headers = { Referer: url, "User-Agent": UA };
      var stream = {
        backend: "mixdrop",
        kind: "mp4",
        quality: quality || "unknown",
        url: mp4Url,
        size: "",
        sizeBytes: 0,
        duration: 0,
        sourceTag: "",
        headers: headers,
        filename: filename,
      };
      return fetchContentLength(fetchImpl, mp4Url, headers).then(function (sizeBytes) {
        stream.size = formatBytes(sizeBytes);
        stream.sizeBytes = sizeBytes;
        return stream;
      });
    })
    .catch(function (err) {
      console.log("[MixDrop] resolveMixDrop error for " + url + ": " + (err && err.message || err));
      return null;
    });
}

// ---------------------------------------------------------------------------
// Embed URL extraction from episode pages (watch-movies.com.pk)
// ---------------------------------------------------------------------------

// Find MixDrop embed URLs in episode page HTML.
// Looks for:
//   1. iframe data-wpfc-original-src="//mxdrop.to/e/..." (lazy-loaded embed)
//   2. iframe src="//mxdrop.to/e/..." (direct embed)
//   3. <a href="https://mxdrop.to/f/...">Click To Download (Link 1 MixDrop 720p)</a> (download links)
function findMixDropEmbeds(markup) {
  var embeds = [];

  // 1. Check iframes (including data-wpfc-original-src for WP Fastest Cache)
  var iframeSrcs = iframeSrcCandidates(markup);
  for (var i = 0; i < iframeSrcs.length; i++) {
    var src = iframeSrcs[i];
    if (isMixDropUrl(src)) {
      embeds.push({ url: normalizeMixDropUrl(src), quality: "" });
    }
  }

  // 2. Check <a> links for MixDrop file/download links
  var allLinks = links(markup);
  for (var j = 0; j < allLinks.length; j++) {
    var href = allLinks[j];
    if (isMixDropUrl(href)) {
      // Extract quality from nearby text in the HTML
      var quality = extractQualityNearLink(markup, href);
      embeds.push({ url: normalizeMixDropUrl(href), quality: quality });
    }
  }

  return dedupeMixDropEmbeds(embeds);
}

// Deduplicate MixDrop embeds by URL, keeping the one with the best quality info.
function dedupeMixDropEmbeds(embeds) {
  var byId = new Map();
  for (var i = 0; i < embeds.length; i++) {
    var e = embeds[i];
    var id = mixDropId(e.url);
    if (!id) {
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, e);
    } else {
      // Prefer the entry with quality info
      var existing = byId.get(id);
      if (!existing.quality && e.quality) {
        byId.set(id, e);
      }
    }
  }
  return Array.from(byId.values());
}

// Extract quality from the text near a MixDrop link in the HTML.
// Looks for patterns like "720p Quality Links MixDrop" or "MixDrop 720p" near the href.
function extractQualityNearLink(markup, href) {
  var text = String(markup || "");
  var idx = text.indexOf(href);
  if (idx === -1) {
    return "";
  }
  // Look in a window around the link for quality info
  var before = text.slice(Math.max(0, idx - 200), idx);
  var after = text.slice(idx, idx + 200);
  var combined = before + after;

  var match = combined.match(/(\d{3,4})p\s*Quality\s*Links\s*MixDrop/i);
  if (match) {
    return match[1] + "p";
  }
  match = combined.match(/MixDrop\s*(\d{3,4})p/i);
  if (match) {
    return match[1] + "p";
  }
  match = combined.match(/(\d{3,4})p/i);
  if (match) {
    return match[1] + "p";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Episode/movie page URL construction + fetching (watch-movies.com.pk)
// ---------------------------------------------------------------------------

// Construct candidate episode page URLs for watch-movies.com.pk.
// The URL pattern is approximately:
//   {WATCH_MOVIES_BASE}{slug}-{year}-{label}-{episode}-{suffix}
// where {label} is "ep" or "episode", and {suffix} comes from EPISODE_SUFFIXES.
// Variations: multiple slug variants, multiple year candidates, multiple episode
// number formats (plain, zero-padded), episode ranges, and a "complete" pattern.
// To add a new URL pattern, add to EPISODE_SUFFIXES or EPISODE_LABELS at the top.
function buildEpisodePageUrls(request) {
  var urls = [];
  var slugs = slugCandidates(request.title);
  var season = request.season;
  var episode = request.episode;

  // Episode number variants: plain, zero-padded to 2 and 3 digits
  var epVariants = [
    String(episode),
    String(episode).padStart(2, "0"),
    String(episode).padStart(3, "0"),
  ];
  epVariants = dedupe(epVariants);

  // Episode range variants: some shows bundle 2 episodes (ep-1-2, ep-3-4)
  var epRanges = [];
  epRanges.push(episode + "-" + (episode + 1));     // ep-N-(N+1)
  if (episode > 1) {
    epRanges.push((episode - 1) + "-" + episode);   // ep-(N-1)-N
  }
  // Zero-padded ranges
  var ep2 = String(episode).padStart(2, "0");
  epRanges.push(ep2 + "-" + String(episode + 1).padStart(2, "0"));
  if (episode > 1) {
    epRanges.push(String(episode - 1).padStart(2, "0") + "-" + ep2);
  }

  // Collect year candidates: episode air date year, season air date year,
  // and the previous year (some sites use the season start year which may
  // differ from the episode air date year by one).
  var years = [];
  if (request.airDate) {
    var epYear = request.airDate.substring(0, 4);
    if (epYear) {
      years.push(epYear);
      years.push(String(Number(epYear) - 1));
    }
  }
  if (request.seasonAirDate) {
    var sYear = request.seasonAirDate.substring(0, 4);
    if (sYear && years.indexOf(sYear) === -1) {
      years.push(sYear);
    }
  }
  years = dedupe(years);

  // Expand suffix templates with the season number
  var expandedSuffixes = EPISODE_SUFFIXES.map(function (s) {
    return s.replace(/\{season\}/g, String(season));
  });

  for (var i = 0; i < slugs.length; i++) {
    var slug = slugs[i];

    // Try each year candidate
    for (var yi = 0; yi < years.length; yi++) {
      var year = years[yi];

      // Single episode variants (plain, zero-padded)
      for (var ei = 0; ei < epVariants.length; ei++) {
        var ep = epVariants[ei];

        // Try each episode label prefix ("ep", "episode") × each suffix pattern
        for (var li = 0; li < EPISODE_LABELS.length; li++) {
          var label = EPISODE_LABELS[li];
          for (var si = 0; si < expandedSuffixes.length; si++) {
            urls.push(
              WATCH_MOVIES_BASE + slug + "-" + year + "-" + label + "-" + ep +
              expandedSuffixes[si]
            );
          }
        }
      }

      // Episode range variants (ep-1-2, ep-3-4, etc.) — only with "ep" label
      for (var ri = 0; ri < epRanges.length; ri++) {
        for (var si2 = 0; si2 < expandedSuffixes.length; si2++) {
          // Skip reality-show suffix for ranges (ranges are for serialized shows)
          if (expandedSuffixes[si2].indexOf("reality-show") !== -1) {
            continue;
          }
          urls.push(
            WATCH_MOVIES_BASE + slug + "-" + year + "-ep-" + epRanges[ri] +
            expandedSuffixes[si2]
          );
        }
      }

      // Pattern: with "complete" for season bundles
      urls.push(
        WATCH_MOVIES_BASE + slug + "-" + year + "-hindi-season-" + season +
        "-complete-watch-online-hd-print-free-download/"
      );
    }

    // Without year (some pages don't include the year)
    for (var ei2 = 0; ei2 < epVariants.length; ei2++) {
      for (var li2 = 0; li2 < EPISODE_LABELS.length; li2++) {
        urls.push(
          WATCH_MOVIES_BASE + slug + "-" + EPISODE_LABELS[li2] + "-" + epVariants[ei2] +
          "-hindi-season-" + season + "-watch-online-hd-print-free-download/"
        );
      }
    }
  }

  return dedupe(urls);
}

// Construct candidate movie page URLs for watch-movies.com.pk.
// Movie URL pattern: {WATCH_MOVIES_BASE}{slug}-{year}{suffix}
// where {suffix} is one of MOVIE_SUFFIXES (e.g. "-hindi-full-movie-watch-online-hd-print-free-download/").
// No season/episode — movies are single videos.
// Ordered best-first: primary slug + release year, then adjacent years, then abbrs.
function buildMoviePageUrls(request) {
  var urls = [];
  var slugs = slugCandidates(request.title);
  var years = [];
  if (request.airDate) {
    var releaseYear = request.airDate.substring(0, 4);
    if (releaseYear) {
      years.push(releaseYear);
      years.push(String(Number(releaseYear) - 1));
      years.push(String(Number(releaseYear) + 1));
    }
  }
  var currentYear = new Date().getFullYear();
  if (years.indexOf(String(currentYear)) === -1) years.push(String(currentYear));
  years = dedupe(years);

  // Prefer full-title slug first (index 0), then expansions
  for (var yi = 0; yi < years.length; yi++) {
    for (var i = 0; i < slugs.length; i++) {
      for (var si = 0; si < MOVIE_SUFFIXES.length; si++) {
        urls.push(WATCH_MOVIES_BASE + slugs[i] + "-" + years[yi] + MOVIE_SUFFIXES[si]);
      }
    }
  }
  for (var i2 = 0; i2 < slugs.length; i2++) {
    for (var si2 = 0; si2 < MOVIE_SUFFIXES.length; si2++) {
      urls.push(WATCH_MOVIES_BASE + slugs[i2] + MOVIE_SUFFIXES[si2]);
    }
  }
  return dedupe(urls);
}

// ---------------------------------------------------------------------------
// Stream resolution pipeline
// ---------------------------------------------------------------------------

// ponytail: race page URLs with short timeout, stop once any page yields embeds.
// Firing every year/slug variant and waiting for all hangs (~120s on CF dead ends).
function resolveFromEpisodePages(fetchImpl, episodeUrls) {
  if (episodeUrls.length === 0) {
    return Promise.resolve([]);
  }

  var PAGE_TIMEOUT_MS = 4000;
  var BATCH = 6;
  var allEmbeds = [];
  var index = 0;

  function resolveEmbeds() {
    if (allEmbeds.length === 0) return Promise.resolve([]);
    return Promise.all(
      allEmbeds.map(function (embed) {
        return resolveMixDrop(embed.url, WATCH_MOVIES_BASE, { fetchImpl: fetchImpl })
          .then(function (stream) {
            if (stream && embed.quality && stream.quality === "unknown") {
              stream.quality = embed.quality;
            }
            return stream;
          })
          .catch(function () { return null; });
      })
    ).then(function (resolved) {
      return dedupeStreams(resolved);
    });
  }

  function nextBatch() {
    if (allEmbeds.length > 0 || index >= episodeUrls.length) {
      return resolveEmbeds();
    }
    var batch = episodeUrls.slice(index, index + BATCH);
    index += BATCH;
    return Promise.all(
      batch.map(function (url) {
        return fetchTextTimeout(fetchImpl, url, { headers: BROWSER_HEADERS }, PAGE_TIMEOUT_MS);
      })
    ).then(function (pages) {
      for (var i = 0; i < pages.length; i++) {
        if (!pages[i]) continue;
        var embeds = findMixDropEmbeds(pages[i]);
        for (var j = 0; j < embeds.length; j++) {
          allEmbeds.push(embeds[j]);
        }
      }
      return nextBatch();
    });
  }

  return nextBatch();
}

function resolveMixDropDesi(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);

  // Movie path: build movie page URLs (no season/episode)
  if (request.mediaType === "movie") {
    var movieUrls = buildMoviePageUrls(request);
    return resolveFromEpisodePages(fetchImpl, movieUrls);
  }

  // TV path (existing logic)
  var episodeUrls = buildEpisodePageUrls(request);
  return resolveFromEpisodePages(fetchImpl, episodeUrls);
}

// ---------------------------------------------------------------------------
// getStreams entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveMixDropDesi(request, { fetchImpl: fetchImpl })
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        // Preserve provider-specific naming from the original
        stream.name = "WatchMovies MixDrop";
        if (stream.sourceTag) {
          stream.name += " (" + stream.sourceTag + ")";
        }
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[MixDrop Desi] resolver failed: " + error.message);
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv" && mediaType !== "movie") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, {})
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[MixDrop Desi] getStreams failed: " + error.message);
      return [];
    });
}

// Dual export pattern for Nuvio sandbox and Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
