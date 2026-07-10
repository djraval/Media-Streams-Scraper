// DesiTVSerials.se Nuvio provider — modular version.
// Resolves Indian TV episodes from desitvserials.se via VkPrime/VkSpeed (MP4) players.
// Player iframes are directly in episode page static HTML — no intermediary needed.

import { TMDB_API_KEY, BROWSER_HEADERS, VKSPEED_HOSTS, VKPRIME_HOSTS } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchContentLength } from "../lib/http.js";
import { dedupe, dedupeStreams, isPlaceholderUrl, embedHostRegex, links, iframeSrcCandidates } from "../lib/html.js";
import { buildMediaRequest, episodeDateSlug } from "../lib/tmdb.js";
import { resolveVkPlayer } from "../lib/vkplayer.js";
import { toNuvioStream, formatBytes } from "../lib/format.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration constants
// ---------------------------------------------------------------------------

var SITE_BASE = "https://desitvserials.se";
var SEARCH_PATH = "/?s=";
var ARCHIVE_PAGE_PATH = "/page/";

// ---------------------------------------------------------------------------
// Layer 0: Site-specific regexes
// ---------------------------------------------------------------------------

var DESITVSERIALS_HOST_RE = new RegExp(
  "^https://(?:www\\.)?desitvserials\\.se/",
  "i",
);
var VKPRIME_RE = embedHostRegex(VKPRIME_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var VKSPEED_RE = embedHostRegex(VKSPEED_HOSTS, "embed-[A-Za-z0-9-]+\\.html");

// ---------------------------------------------------------------------------
// Provider-specific displayBackend — camelcase transformation for stream names.
// The shared format.js displayBackend returns the raw string; this provider
// uses a capitalized form (e.g. "vkspeed" → "Vkspeed") in stream names.
// ---------------------------------------------------------------------------

function displayBackend(backend) {
  return String(backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, function (_match, prefix, ch) { return prefix + ch.toUpperCase(); })
    .replace(/[-_]+/g, "");
}

// ---------------------------------------------------------------------------
// Layer 3: Embed URL extraction from episode pages
// ---------------------------------------------------------------------------

// Extract VkPrime/VkSpeed iframe src URLs from episode page markup.
// Checks all iframe attribute variants (src, data-src, data-wpfc-original-src,
// data-lazy-src) via iframeSrcCandidates, then filters to known player hosts.
function findPlayerIframes(markup) {
  return dedupe(iframeSrcCandidates(markup).filter(function (href) {
    return VKPRIME_RE.test(href) || VKSPEED_RE.test(href);
  }));
}

// ---------------------------------------------------------------------------
// Layer 2: Site search + episode page discovery
// ---------------------------------------------------------------------------

// Build WordPress search URLs for desitvserials.se.
// Each URL encodes the show slug + episode date slug as the search query.
function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) {
    return [];
  }
  var dateQuery = dateSlug.replace(/-/g, " ");
  return (request.slugCandidates || []).map(function (slug) {
    return SITE_BASE + SEARCH_PATH + encodeURIComponent(slug + " " + dateQuery).replace(/%20/g, "+");
  });
}

// Build archive page URLs for desitvserials.se.
// Each show has a main archive at /{slug}/ plus paginated archives at
// /{slug}/page/2/ and /{slug}/page/3/.
function buildArchiveUrls(request) {
  var urls = [];
  var slugs = request.slugCandidates || [];
  for (var i = 0; i < slugs.length; i += 1) {
    urls.push(SITE_BASE + "/" + slugs[i] + "/");
    urls.push(SITE_BASE + "/" + slugs[i] + ARCHIVE_PAGE_PATH + "2/");
    urls.push(SITE_BASE + "/" + slugs[i] + ARCHIVE_PAGE_PATH + "3/");
  }
  return dedupe(urls);
}

// Filter links from a search/archive page to episode page candidates.
// An episode page URL must:
//   1. Be on desitvserials.se (DESITVSERIALS_HOST_RE)
//   2. Contain the date slug (e.g. "15th-january-2024")
//   3. Contain one of the show slug candidates
function episodePageCandidates(markup, request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) {
    return [];
  }
  return dedupe(
    links(markup).filter(function (href) {
      if (!DESITVSERIALS_HOST_RE.test(href)) {
        return false;
      }
      if (href.toLowerCase().indexOf(dateSlug) === -1) {
        return false;
      }
      return (request.slugCandidates || []).some(function (slug) {
        return href.toLowerCase().indexOf(slug) !== -1;
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// Layer 4: Player resolution — episode pages → VkPrime/VkSpeed → direct MP4
// ---------------------------------------------------------------------------

// Resolve episode page URLs to direct MP4 streams.
// 1. Fetch each episode page
// 2. Extract VkPrime/VkSpeed iframe URLs
// 3. Resolve each iframe via resolveVkPlayer (shared lib) → array of MP4 sources
// 4. Filter placeholder URLs, take the best (highest quality) source per iframe
// 5. Fetch content-length for size display
// 6. Decorate with backend/name/sourceTag fields for toNuvioStream
function resolveFromEpisodeUrls(fetchImpl, episodeUrls) {
  if (episodeUrls.length === 0) {
    return Promise.resolve([]);
  }
  return Promise.all(
    episodeUrls.map(function (url) {
      return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS })
        .catch(function (e) {
          console.log("[DesiTVSerials.se] episode page fetch failed for " + url + ": " + (e && e.message));
          return null;
        });
    })
  ).then(function (episodePages) {
    var allIframeUrls = dedupe(
      episodePages.flatMap(function (page) {
        return page ? findPlayerIframes(page) : [];
      })
    );
    if (allIframeUrls.length === 0) {
      return [];
    }
    return Promise.all(
      allIframeUrls.map(function (iframeUrl) {
        var backend = iframeUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
        return resolveVkPlayer(iframeUrl, SITE_BASE + "/", { fetchImpl: fetchImpl })
          .then(function (sources) {
            // Filter placeholder URLs and take the best (first) source,
            // matching original behavior which returned only real[0].
            var real = (sources || []).filter(function (s) {
              return !isPlaceholderUrl(s.url);
            });
            if (real.length === 0) {
              return null;
            }
            var best = real[0];
            var stream = {
              backend: backend,
              kind: "mp4",
              quality: best.quality || "unknown",
              url: best.url,
              size: "",
              sizeBytes: 0,
              duration: 0,
              sourceTag: "",
              headers: best.headers,
            };
            return fetchContentLength(fetchImpl, best.url, best.headers).then(function (sizeBytes) {
              stream.size = formatBytes(sizeBytes);
              stream.sizeBytes = sizeBytes;
              return stream;
            });
          })
          .catch(function (e) {
            console.log("[DesiTVSerials.se] player resolution failed for " + iframeUrl + ": " + (e && e.message));
            return null;
          });
      })
    ).then(function (resolved) {
      return dedupeStreams(resolved);
    });
  });
}

// Recursively process archive pages to find episode page candidates.
// Stops at the first archive page that yields streams.
function processArchive(fetchImpl, archiveUrls, request, index) {
  if (index >= archiveUrls.length) {
    return Promise.resolve([]);
  }
  return fetchText(fetchImpl, archiveUrls[index], { headers: BROWSER_HEADERS })
    .then(function (archive) {
      if (!archive) {
        return processArchive(fetchImpl, archiveUrls, request, index + 1);
      }
      var episodeUrls = episodePageCandidates(archive, request);
      if (episodeUrls.length === 0) {
        return processArchive(fetchImpl, archiveUrls, request, index + 1);
      }
      return resolveFromEpisodeUrls(fetchImpl, episodeUrls).then(function (streams) {
        if (streams.length > 0) {
          return streams;
        }
        return processArchive(fetchImpl, archiveUrls, request, index + 1);
      });
    });
}

// Main resolution flow for desitvserials.se:
// 1. Search via WordPress ?s= query (search pages)
// 2. If no episode pages found from search, fall back to archive pages
function resolveDesiTVSerials(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var searchUrls = buildSearchUrls(request);
  var archiveUrls = buildArchiveUrls(request);

  if (searchUrls.length > 0) {
    return Promise.all(
      searchUrls.map(function (url) {
        return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS });
      })
    ).then(function (searchPages) {
      var episodeUrls = dedupe(
        searchPages.flatMap(function (page) {
          return page ? episodePageCandidates(page, request) : [];
        })
      );
      if (episodeUrls.length > 0) {
        return resolveFromEpisodeUrls(fetchImpl, episodeUrls);
      }
      return processArchive(fetchImpl, archiveUrls, request, 0);
    });
  }

  return processArchive(fetchImpl, archiveUrls, request, 0);
}

// ---------------------------------------------------------------------------
// Layer 5 + Layer 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveDesiTVSerials(request, { fetchImpl: fetchImpl })
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        // Preserve provider-specific naming: "DesiTVSerials.se Vkspeed" etc.
        stream.name = "DesiTVSerials.se " + displayBackend(stream.backend);
        if (stream.sourceTag) {
          stream.name += " (" + stream.sourceTag + ")";
        }
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[DesiTVSerials.se] resolver failed: " + error.message);
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
      console.log("[DesiTVSerials.se] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
