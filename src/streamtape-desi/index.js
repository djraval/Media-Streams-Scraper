// StreamTape Desi Nuvio provider — modular version.
// Resolves Indian TV episodes and movies from watch-movies.com.pk and ulluhd.com
// via StreamTape (MP4) player. StreamTape uses robotlink JS obfuscation with
// substring offsets → get_video URL → 302 redirect → CDN MP4.

import { UA, BROWSER_HEADERS, TMDB_API_KEY } from "../lib/constants.js";
import { resolveFetch, fetchFirstResult, browserHeaders } from "../lib/http.js";
import { dedupe, dedupeStreams, decodeText, links } from "../lib/html.js";
import { buildMediaRequest, slugCandidates } from "../lib/tmdb.js";
import { toNuvioStream } from "../lib/format.js";

// ---------------------------------------------------------------------------
// Layer 0: Configuration constants
// ---------------------------------------------------------------------------

// StreamTape domains — all resolve the same way via robotlink/norobotlink JS.
var STREAMTAPE_DOMAINS = [
  "streamtape.com",
  "streamtape.to",
  "streamtape.xyz",
  "streamtape.cc",
  "stape.fun",
  "strcloud.club",
  "strcloud.link",
  "streamadblocker.com",
];

// Regex to test if a URL points to any known StreamTape domain.
// Built from STREAMTAPE_DOMAINS so adding a domain above automatically
// updates all URL-matching logic throughout the file.
var STREAMTAPE_DOMAIN_RE = new RegExp(
  "(" + STREAMTAPE_DOMAINS.map(function (d) {
    return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|") + ")",
  "i"
);

// Regex to extract StreamTape video IDs from page content.
// Matches streamtape.com/e/{id}, streamtape.to/v/{id}, strcloud.club/v/{id}, etc.
var STREAMTAPE_URL_RE = new RegExp(
  "https?://(?:www\\.)?(?:" +
  STREAMTAPE_DOMAINS.map(function (d) {
    return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|") +
  ")/(?:e|v|d)/([A-Za-z0-9]+)",
  "gi"
);

// Site configuration — base URLs for each scraped site.
var WATCH_MOVIES_BASE = "https://www.watch-movies.com.pk/";
var ULLUHD_BASE = "https://ulluhd.com/";
var STREAMTAPE_EMBED_BASE = "https://streamtape.to/v/";

// Episode URL suffix templates — {season} is replaced with the season number.
// Add new patterns here when the site changes its URL structure.
var EPISODE_SUFFIXES = [
  "-hindi-season-{season}-watch-online-hd-print-free-download/",
  "-hindi-dubbed-season-{season}-watch-online-hd-print-free-download/",
  "-hindi-reality-show-watch-online-hd-print-free-download/",
];

// Movie URL suffix templates — no season/episode, just the movie title + year.
var MOVIE_SUFFIXES = [
  "-hindi-full-movie-watch-online-hd-print-free-download/",
  "-hindi-dubbed-full-movie-watch-online-hd-print-free-download/",
];

// Episode label prefixes used in URL paths ("ep" and "episode" both appear).
var EPISODE_LABELS = ["ep", "episode"];

// ---------------------------------------------------------------------------
// Layer 3: Embed URL extraction from episode pages
// ---------------------------------------------------------------------------

// Check if a URL is a StreamTape URL (any known domain).
function isStreamTapeUrl(url) {
  return STREAMTAPE_DOMAIN_RE.test(String(url || ""));
}

// Extract StreamTape video IDs from page content using STREAMTAPE_URL_RE
// (built from STREAMTAPE_DOMAINS at the top of the file).
function extractStreamTapeIds(raw) {
  var text = decodeText(raw);
  var ids = [];
  var match;
  STREAMTAPE_URL_RE.lastIndex = 0;
  while ((match = STREAMTAPE_URL_RE.exec(text)) !== null) {
    ids.push(match[1]);
  }
  return dedupe(ids);
}

// Extract quality label near a StreamTape link in the page.
function qualityNearStreamTape(raw) {
  var text = decodeText(raw);
  // Look for patterns like "720p Quality Links Streamtape" or "Streamtape 720p"
  var patterns = [
    /(\d{3,4})p\s*(?:Quality\s*Links\s*)?Streamtape/gi,
    /Streamtape\s*(\d{3,4})p/gi,
    /Quality[^<]*?(\d{3,4})p[^<]*?Streamtape/gi,
  ];
  var best = 0;
  for (var i = 0; i < patterns.length; i += 1) {
    var m;
    patterns[i].lastIndex = 0;
    while ((m = patterns[i].exec(text)) !== null) {
      var h = Number(m[1]);
      if (h > best) {
        best = h;
      }
    }
  }
  // Also check for generic quality labels near streamtape links
  if (best === 0) {
    var stIdx = text.toLowerCase().indexOf("streamtape");
    if (stIdx !== -1) {
      var window = text.slice(Math.max(0, stIdx - 200), stIdx + 200);
      var qMatch = window.match(/(\d{3,4})p/i);
      if (qMatch) {
        best = Number(qMatch[1]);
      }
    }
  }
  return best > 0 ? best + "p" : "unknown";
}

// ---------------------------------------------------------------------------
// Layer 4: Player resolution — StreamTape robotlink/norobotlink decoding
// ---------------------------------------------------------------------------

// Parse the robotlink/norobotlink/captchalink innerHTML assignment and apply substring operations.
// Returns the get_video URL or empty string.
function parseGetVideoUrl(html) {
  // Match: getElementById('ELEMENT_ID').innerHTML = 'prefix'+ ('junk_string').substring(N).substring(M)
  // The element ID, prefix, junk string, and substring offsets all vary.
  // We try all matches and pick the one that produces a valid get_video URL.
  var regex = /getElementById\('([^']+)'\)\.innerHTML\s*=\s*["']([^"']*)["']\s*(?:\+\s*['"]['"]?\s*)?\+\s*\(['"]([^'"]+)['"]\)\.substring\((\d+)\)(?:\.substring\((\d+)\))?/g;
  var match;
  var bestUrl = "";
  while ((match = regex.exec(html)) !== null) {
    var elemId = match[1];
    var prefix = match[2];
    var junk = match[3];
    var sub1 = Number(match[4]) || 0;
    var sub2 = Number(match[5] || 0);

    // Apply substring operations
    var suffix = junk;
    if (sub1 > 0) {
      suffix = suffix.substring(sub1);
    }
    if (sub2 > 0) {
      suffix = suffix.substring(sub2);
    }

    var fullUrl = prefix + suffix;

    // Check if this produces a valid get_video URL
    if (fullUrl.indexOf("get_video") !== -1) {
      // Normalize: prepend https: if it starts with //
      if (fullUrl.indexOf("//") === 0) {
        fullUrl = "https:" + fullUrl;
      }
      // Prefer norobotlink and captchalink (they have the real token)
      // ideoooolink is typically a decoy with wrong domain
      if (elemId.indexOf("robotlink") !== -1 || elemId.indexOf("captchalink") !== -1) {
        return fullUrl;
      }
      // Keep as fallback if we haven't found a better one
      if (!bestUrl) {
        bestUrl = fullUrl;
      }
    }
  }
  return bestUrl;
}

// Extract the StreamTape video ID from any StreamTape URL.
function extractStreamTapeId(url) {
  var match = String(url || "").match(/\/(?:e|v|d)\/([A-Za-z0-9]+)/);
  return match ? match[1] : "";
}

// Determine the base URL for fetching the embed page.
function streamtapeEmbedUrl(videoId, originalUrl) {
  // Try to use the same domain as the original URL, or default to streamtape.to
  var domain = "streamtape.to";
  var match = String(originalUrl || "").match(/https?:\/\/(?:www\.)?([^/]+)/i);
  if (match) {
    var host = match[1].toLowerCase();
    for (var i = 0; i < STREAMTAPE_DOMAINS.length; i += 1) {
      if (host.indexOf(STREAMTAPE_DOMAINS[i]) !== -1) {
        domain = STREAMTAPE_DOMAINS[i];
        break;
      }
    }
  }
  return "https://" + domain + "/v/" + videoId;
}

// Resolve a StreamTape embed URL to a direct CDN MP4 URL.
// 1. Fetch the embed page (try multiple StreamTape domains)
// 2. Parse the robotlink/norobotlink JS → substring decode → get_video URL
// 3. Fetch the get_video URL with Referer header → 302 redirect to CDN
// 4. Return the CDN URL
function resolveStreamTape(embedUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var videoId = extractStreamTapeId(embedUrl);
  if (!videoId) {
    return Promise.resolve(null);
  }

  // Try all known StreamTape domains — some videos may be available on one but not another.
  // Uses STREAMTAPE_DOMAINS from the top of the file (single source of truth).
  var domains = STREAMTAPE_DOMAINS;
  var pageUrl = "";
  var html = null;

  function tryDomain(index) {
    if (index >= domains.length) {
      return Promise.resolve(null);
    }
    pageUrl = "https://" + domains[index] + "/v/" + videoId;
    // Use a custom fetch that gets text even on non-200 responses
    // (StreamTape may return 404 but still serve the page with robotlink JS)
    return fetchImpl(pageUrl, browserHeaders(""))
      .then(function (response) {
        if (!response) {
          return tryDomain(index + 1);
        }
        return response.text().then(function (text) {
          // Check if the page has the robotlink/norobotlink pattern
          if (text && (text.indexOf("norobotlink") !== -1 || text.indexOf("robotlink") !== -1 || text.indexOf("get_video") !== -1)) {
            html = text;
            return text;
          }
          // If no robotlink pattern, try next domain
          return tryDomain(index + 1);
        });
      })
      .catch(function () {
        return tryDomain(index + 1);
      });
  }

  return tryDomain(0)
    .then(function () {
      if (!html) {
        console.log("[StreamTape] no embed page with robotlink found for video ID " + videoId);
        return null;
      }
      var getVideoUrl = parseGetVideoUrl(html);
      if (!getVideoUrl) {
        console.log("[StreamTape] could not parse get_video URL from robotlink JS for " + pageUrl);
        return null;
      }
      // Append &stream=1 if not present
      if (getVideoUrl.indexOf("stream=1") === -1) {
        getVideoUrl += (getVideoUrl.indexOf("?") !== -1 ? "&" : "?") + "stream=1";
      }
      // Fetch the get_video URL with redirect: manual to capture the 302 Location
      return fetchImpl(getVideoUrl, {
        redirect: "manual",
        headers: Object.assign({}, BROWSER_HEADERS, { Referer: pageUrl }),
      })
        .then(function (response) {
          if (!response) {
            console.log("[StreamTape] get_video fetch returned no response for " + getVideoUrl);
            return null;
          }
          // The get_video endpoint returns 302 → CDN URL
          var location = "";
          if (response.headers && typeof response.headers.get === "function") {
            location = response.headers.get("location") || "";
          }
          // Some environments follow redirects automatically (status 200 with CDN URL in response.url)
          if (!location && response.url && response.url.indexOf("tapecontent.net") !== -1) {
            location = response.url;
          }
          // Also check if response.ok and the URL is already the CDN URL
          if (!location && response.ok && response.url) {
            location = response.url;
          }
          if (!location) {
            console.log("[StreamTape] no CDN redirect location from get_video for " + getVideoUrl);
            return null;
          }
          return {
            cdnUrl: location,
            embedUrl: pageUrl,
            videoId: videoId,
          };
        })
        .catch(function (err) {
          console.log("[StreamTape] get_video fetch error for " + getVideoUrl + ": " + (err && err.message || err));
          return null;
        });
    })
    .catch(function (err) {
      console.log("[StreamTape] resolveStreamTape error for video ID " + videoId + ": " + (err && err.message || err));
      return null;
    });
}

// ---------------------------------------------------------------------------
// Layer 2: Episode page URL construction + fetching
// ---------------------------------------------------------------------------

// watch-movies.com.pk: WordPress site with StreamTape links for Indian TV shows.
// The site is behind Cloudflare, so WordPress search (?s=) is blocked.
// Instead, we construct episode URLs directly based on the show name, season,
// episode, and air year.
// URL pattern: {WATCH_MOVIES_BASE}{slug}-{year}-{label}-{episode}-{suffix}
// To add a new URL pattern, add to EPISODE_SUFFIXES or EPISODE_LABELS at the top.

var WATCH_MOVIES_HOST_RE = /^https:\/\/www\.watch-movies\.com\.pk\//i;

function buildWatchMoviesEpisodeUrls(request) {
  var slugs = request.slugCandidates || [];
  var season = request.season;
  var episode = request.episode;
  var urls = [];

  // Episode number variants: plain, zero-padded to 2 and 3 digits
  var epVariants = [
    String(episode),
    String(episode).padStart(2, "0"),
    String(episode).padStart(3, "0"),
  ];
  epVariants = dedupe(epVariants);

  // Determine candidate years: air year, current year, and adjacent years
  var years = [];
  var airYear = request.airYear || String(request.airDate || "").substring(0, 4);
  if (airYear) years.push(airYear);
  var currentYear = new Date().getFullYear();
  if (years.indexOf(String(currentYear)) === -1) {
    years.push(String(currentYear));
  }
  if (airYear) {
    var airYearNum = Number(airYear);
    if (years.indexOf(String(airYearNum - 1)) === -1) {
      years.push(String(airYearNum - 1));
    }
    if (years.indexOf(String(airYearNum + 1)) === -1) {
      years.push(String(airYearNum + 1));
    }
  }

  // Expand suffix templates with the season number
  var expandedSuffixes = EPISODE_SUFFIXES.map(function (s) {
    return s.replace(/\{season\}/g, String(season));
  });

  for (var ps = 0; ps < slugs.length; ps += 1) {
    for (var py = 0; py < years.length; py += 1) {
      urls.push(
        WATCH_MOVIES_BASE + slugs[ps] + "-" + years[py] + "-ep-" +
        String(episode).padStart(2, "0") + expandedSuffixes[0]
      );
    }
  }

  for (var s = 0; s < slugs.length; s += 1) {
    for (var y = 0; y < years.length; y += 1) {
      // Try each episode variant × each label × each suffix pattern
      for (var ev = 0; ev < epVariants.length; ev += 1) {
        for (var li = 0; li < EPISODE_LABELS.length; li += 1) {
          for (var xi = 0; xi < expandedSuffixes.length; xi += 1) {
            urls.push(
              WATCH_MOVIES_BASE + slugs[s] + "-" + years[y] +
              "-" + EPISODE_LABELS[li] + "-" + epVariants[ev] + expandedSuffixes[xi]
            );
          }
        }
      }
    }
  }
  return dedupe(urls);
}

// Construct candidate movie page URLs for watch-movies.com.pk.
// Movie URL pattern: {WATCH_MOVIES_BASE}{slug}-{year}{suffix}
// where {suffix} is one of MOVIE_SUFFIXES (e.g. "-hindi-full-movie-watch-online-hd-print-free-download/").
// No season/episode — movies are single videos.
function buildWatchMoviesMovieUrls(request) {
  var slugs = request.slugCandidates || [];
  var urls = [];

  // Determine candidate years: release year, current year, and adjacent years
  var years = [];
  var airYear = request.airYear || String(request.airDate || "").substring(0, 4);
  if (airYear) years.push(airYear);
  var currentYear = new Date().getFullYear();
  if (years.indexOf(String(currentYear)) === -1) {
    years.push(String(currentYear));
  }
  if (airYear) {
    var airYearNum = Number(airYear);
    if (years.indexOf(String(airYearNum - 1)) === -1) {
      years.push(String(airYearNum - 1));
    }
    if (years.indexOf(String(airYearNum + 1)) === -1) {
      years.push(String(airYearNum + 1));
    }
  }

  for (var s = 0; s < slugs.length; s += 1) {
    for (var y = 0; y < years.length; y += 1) {
      for (var xi = 0; xi < MOVIE_SUFFIXES.length; xi += 1) {
        urls.push(WATCH_MOVIES_BASE + slugs[s] + "-" + years[y] + MOVIE_SUFFIXES[xi]);
      }
    }
    // Also try without year
    for (var xi2 = 0; xi2 < MOVIE_SUFFIXES.length; xi2 += 1) {
      urls.push(WATCH_MOVIES_BASE + slugs[s] + MOVIE_SUFFIXES[xi2]);
    }
  }
  return dedupe(urls);
}

// Check if a page contains StreamTape links.
function watchMoviesHasStreamTape(markup) {
  return extractStreamTapeIds(markup).length > 0 ||
    links(markup).some(function (href) {
      return isStreamTapeUrl(href);
    });
}

// ulluhd.com: WordPress site with StreamTape links for Indian web series.
// Episode page structure: <a href="https://strcloud.club/v/{id}/...">StreamTape Video Link</a>

var ULLUHD_HOST_RE = /^https:\/\/ulluhd\.com\//i;

function buildUlluhdSearchUrls(request) {
  var title = request.title || "";
  var slugs = slugCandidates(title).slice(0, 2);
  var urls = [];
  for (var i = 0; i < slugs.length; i += 1) {
    urls.push(ULLUHD_BASE + "?s=" + encodeURIComponent(slugs[i]).replace(/%20/g, "+"));
  }
  return urls;
}

function ulluhdEpisodeCandidates(markup, request) {
  var allLinks = links(markup);
  var titleSlugs = request.slugCandidates || [];
  var season = request.season;
  var episode = request.episode;
  return dedupe(
    allLinks.filter(function (href) {
      if (!ULLUHD_HOST_RE.test(href)) {
        return false;
      }
      var lower = href.toLowerCase();
      var titleMatch = titleSlugs.some(function (slug) {
        return lower.indexOf(slug) !== -1;
      });
      if (!titleMatch) {
        return false;
      }
      // Check for season/episode match
      var seasonStr = String(season);
      var episodeStr = String(episode);
      var seasonPadded = String(season).padStart(2, "0");
      var episodePadded = String(episode).padStart(2, "0");

      var seasonMatch =
        lower.indexOf("s" + seasonStr) !== -1 ||
        lower.indexOf("s" + seasonPadded) !== -1 ||
        lower.indexOf("season-" + seasonStr) !== -1;

      var episodeMatch =
        lower.indexOf("e" + episodeStr) !== -1 ||
        lower.indexOf("e" + episodePadded) !== -1 ||
        lower.indexOf("ep" + episodePadded) !== -1 ||
        lower.indexOf("ep-" + episodeStr) !== -1 ||
        lower.indexOf("e" + episodePadded) !== -1;

      // For batch episodes (e.g., E01-06), match if episode is in range
      if (!episodeMatch) {
        var batchMatch = lower.match(/e(\d{1,2})-e?(\d{1,2})/i);
        if (batchMatch) {
          var startEp = Number(batchMatch[1]);
          var endEp = Number(batchMatch[2]);
          if (episode >= startEp && episode <= endEp) {
            episodeMatch = true;
          }
        }
      }

      return seasonMatch && episodeMatch;
    }),
  );
}

// ---------------------------------------------------------------------------
// Layer 2 (continued) + Layer 3 + Layer 4: Main resolution flow
// ---------------------------------------------------------------------------

function searchSite(fetchImpl, searchUrls, episodeCandidateFn, request) {
  if (searchUrls.length === 0) return Promise.resolve([]);
  return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function (page) {
    var episodeUrls = episodeCandidateFn(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function (episodeUrls) {
    return episodeUrls || [];
  });
}

// Resolve StreamTape embeds from an array of {url, html} page objects.
// Shared by both TV and movie resolution paths.
function resolveStreamTapeFromPages(fetchImpl, pages) {
  var allEntries = [];
  for (var i = 0; i < pages.length; i += 1) {
    var page = pages[i].html;
    var ids = extractStreamTapeIds(page);
    var quality = qualityNearStreamTape(page);
    for (var j = 0; j < ids.length; j += 1) {
      allEntries.push({ id: ids[j], quality: quality });
    }
    // Also check for StreamTape links in <a> href attributes
    var pageLinks = links(page);
    for (var m = 0; m < pageLinks.length; m += 1) {
      var linkUrl = pageLinks[m];
      if (isStreamTapeUrl(linkUrl)) {
        var id = extractStreamTapeId(linkUrl);
        if (id) {
          allEntries.push({ id: id, quality: qualityNearStreamTape(page) });
        }
      }
    }
  }

  // Deduplicate by ID
  var seenIds = new Set();
  var uniqueEntries = [];
  for (var n = 0; n < allEntries.length; n += 1) {
    if (!seenIds.has(allEntries[n].id)) {
      seenIds.add(allEntries[n].id);
      uniqueEntries.push(allEntries[n]);
    }
  }

  if (uniqueEntries.length === 0) {
    return Promise.resolve([]);
  }

  // Resolve each StreamTape ID to a CDN URL
  return Promise.all(
    uniqueEntries.map(function (entry) {
      var embedUrl = STREAMTAPE_EMBED_BASE + entry.id;
      return resolveStreamTape(embedUrl, { fetchImpl: fetchImpl })
        .then(function (resolved) {
          if (!resolved || !resolved.cdnUrl) {
            return null;
          }
          return {
            kind: "mp4",
            quality: entry.quality,
            url: resolved.cdnUrl,
            size: "",
            duration: 0,
            sourceTag: "",
            headers: {
              Referer: resolved.embedUrl,
              "User-Agent": UA,
            },
          };
        })
        .catch(function () { return null; });
    })
  ).then(function (resolved) {
    return dedupeStreams(resolved.filter(function (s) { return s !== null; }));
  });
}

function resolveStreamTapeDesi(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);

  function firstPage(urls) {
    return fetchFirstResult(fetchImpl, urls.slice(0, 8), { headers: BROWSER_HEADERS }, function (html, url) {
      return { url: url, html: html };
    });
  }

  if (request.mediaType === "movie") {
    return firstPage(buildWatchMoviesMovieUrls(request)).then(function (page) {
      if (!page || !watchMoviesHasStreamTape(page.html)) return [];
      return resolveStreamTapeFromPages(fetchImpl, [page]);
    });
  }

  return firstPage(buildWatchMoviesEpisodeUrls(request)).then(function (page) {
    if (page && watchMoviesHasStreamTape(page.html)) {
      return resolveStreamTapeFromPages(fetchImpl, [page]);
    }
    return searchSite(fetchImpl, buildUlluhdSearchUrls(request), ulluhdEpisodeCandidates, request)
      .then(function (episodeUrls) {
        return firstPage(episodeUrls);
      })
      .then(function (ulluhdPage) {
        if (!ulluhdPage || !watchMoviesHasStreamTape(ulluhdPage.html)) return [];
        return resolveStreamTapeFromPages(fetchImpl, [ulluhdPage]);
      });
  });
}

// ---------------------------------------------------------------------------
// Layer 5 + Layer 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveStreamTapeDesi(request, { fetchImpl: fetchImpl })
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        // Preserve provider-specific naming: "StreamTape Desi"
        stream.name = "StreamTape Desi";
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[StreamTape Desi] resolver failed: " + error.message);
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv" && mediaType !== "movie") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[StreamTape Desi] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
