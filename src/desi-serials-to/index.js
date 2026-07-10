// Desi-Serials.to Nuvio provider — resolves Indian TV episodes from desi-serials.to
// via VkPrime/VkSpeed (MP4) and Flow (HLS) players.

import { TMDB_API_KEY, UA, BROWSER_HEADERS, VKSPEED_HOSTS, VKPRIME_HOSTS } from "../lib/constants.js";
import { resolveFetch, browserHeaders, fetchText, fetchFirstResult, fetchContentLength } from "../lib/http.js";
import {
  dedupe,
  dedupeStreams,
  isPlaceholderUrl,
  embedHostRegex,
  links,
  iframeSrcCandidates,
  m3u8Candidates,
  resolveRelativeUrl,
  nextUriLine,
} from "../lib/html.js";
import { buildMediaRequest, episodeDateSlug } from "../lib/tmdb.js";
import { decodeJuicyCodes } from "../lib/packer.js";
import { resolveVkPlayer } from "../lib/vkplayer.js";
import { formatBytes, toNuvioStream } from "../lib/format.js";

// --- Layer 0: Site configuration constants ---

var SITE_BASE = "https://www.desi-serials.to";
var SEARCH_PATH = "/?s=";
var WATCH_PATH = "/watch-online/";
var ARCHIVE_PAGE_PATH = "page/";
var TVARTICLES_HOST = "tvarticles.org";

var FLOW_HOSTS = ["flow.tvlogy.to"];

var DESI_SERIALS_HOST_RE = new RegExp(
  "^https://(?:www\\.)?desi-serials\\.to/",
  "i",
);
var TVARTICLES_RE = new RegExp(
  "^https://" + TVARTICLES_HOST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/vidd\\.php\\?id=\\d+",
  "i",
);
var VKPRIME_RE = embedHostRegex(VKPRIME_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var VKSPEED_RE = embedHostRegex(VKSPEED_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var FLOW_RE = embedHostRegex(FLOW_HOSTS, "[A-Za-z0-9/_-]+/?");

// --- Provider-specific display name construction ---
// The original displayBackend capitalizes words and removes hyphens/underscores,
// producing "Vkprime", "Vkspeed", "Flow" etc. The shared displayBackend in
// format.js returns the raw string, so we construct the full name here.

function providerDisplayName(stream) {
  var backend = String(stream.backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, function (_match, prefix, ch) {
      return prefix + ch.toUpperCase();
    })
    .replace(/[-_]+/g, "");
  var name = "Desi-Serials.to " + backend;
  if (stream.sourceTag) {
    name += " (" + stream.sourceTag + ")";
  }
  return name;
}

// --- Layer 2: Site search + episode page discovery ---

function buildCandidateUrls(request) {
  var channels = (request.networkCandidates && request.networkCandidates.length > 0)
    ? request.networkCandidates
    : request.fallbackChannelSlugs;
  var urls = [];
  for (var i = 0; i < channels.length; i++) {
    var channel = channels[i];
    var slugs = (request.slugCandidates || []).slice(0, 2);
    for (var j = 0; j < slugs.length; j++) {
      var slug = slugs[j];
      urls.push(SITE_BASE + WATCH_PATH + channel + "/" + slug + "/");
      urls.push(SITE_BASE + WATCH_PATH + channel + "/" + slug + "/" + ARCHIVE_PAGE_PATH + "2/");
      urls.push(SITE_BASE + WATCH_PATH + channel + "/" + slug + "/" + ARCHIVE_PAGE_PATH + "3/");
    }
  }
  return { desiSerials: dedupe(urls) };
}

function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) {
    return [];
  }
  // WordPress search requires words separated by + (spaces), not hyphens.
  // The date slug is "10th-april-2026" but the search query needs "10th april 2026".
  var dateQuery = dateSlug.replace(/-/g, " ");
  var slugs = (request.slugCandidates || []).slice(0, 2);
  var urls = [];
  for (var i = 0; i < slugs.length; i++) {
    urls.push(
      SITE_BASE + SEARCH_PATH + encodeURIComponent(slugs[i] + " " + dateQuery).replace(/%20/g, "+"),
    );
  }
  return urls;
}

function episodePageCandidates(markup, request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) {
    return [];
  }
  var slugs = request.slugCandidates || [];
  return dedupe(
    links(markup).filter(function (href) {
      if (!DESI_SERIALS_HOST_RE.test(href)) {
        return false;
      }
      if (!href.toLowerCase().includes(dateSlug)) {
        return false;
      }
      return slugs.some(function (slug) {
        return href.toLowerCase().includes(slug);
      });
    }),
  );
}

function tvarticlesLinks(markup) {
  return dedupe(
    links(markup).filter(function (href) {
      return TVARTICLES_RE.test(href);
    }),
  );
}

// --- Layer 3: Embed URL extraction from episode pages ---

function findPlayerIframe(markup) {
  return (
    iframeSrcCandidates(markup).find(function (href) {
      return VKPRIME_RE.test(href) || VKSPEED_RE.test(href) || FLOW_RE.test(href);
    }) || ""
  );
}

// --- Layer 4: Player resolution (VkSpeed/VkPrime/Flow → direct stream URL) ---

// VkPrime/VkSpeed adapter — wraps the shared resolveVkPlayer (which returns an
// array of {url, quality, kind, headers}) and adapts it to the single-stream
// format with backend/size/duration/sourceTag that the rest of the provider
// expects. Also filters placeholder URLs and fetches content-length for size.

function resolveVkPlayerAdapter(embedUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveVkPlayer(embedUrl, refererUrl, { fetchImpl: fetchImpl })
    .then(function (sources) {
      if (!sources || sources.length === 0) {
        return null;
      }
      var real = sources.filter(function (entry) {
        return !isPlaceholderUrl(entry.url);
      });
      if (real.length === 0) {
        return null;
      }
      var best = real[0];
      var headers = { Referer: embedUrl, "User-Agent": UA };
      var backend = embedUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
      var stream = {
        backend: backend,
        kind: "mp4",
        quality: best.quality || "unknown",
        url: best.url,
        size: "",
        sizeBytes: 0,
        duration: 0,
        sourceTag: "",
        headers: headers,
      };
      return fetchContentLength(fetchImpl, best.url, headers).then(function (sizeBytes) {
        stream.size = formatBytes(sizeBytes);
        stream.sizeBytes = sizeBytes;
        return stream;
      });
    });
}

// --- Flow HLS player resolution ---

function hlsQualityFromManifest(raw) {
  var matches = String(raw || "").matchAll(/RESOLUTION=\d+x(\d{3,4})/gi);
  var max = 0;
  for (var m of matches) {
    var height = Number(m[1]);
    if (height > max) {
      max = height;
    }
  }
  return max > 0 ? max + "p" : "unknown";
}

function parseHlsMasterPlaylist(raw, baseUrl) {
  var variants = [];
  var lines = String(raw || "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      var resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
      var avgBwMatch = line.match(/AVERAGE-BANDWIDTH=(\d+)/i);
      var bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      var height = resMatch ? Number(resMatch[1]) : 0;
      // Prefer AVERAGE-BANDWIDTH for size estimation (closer to actual bytes);
      // fall back to BANDWIDTH (peak) if not present.
      var bandwidth = avgBwMatch ? Number(avgBwMatch[1]) : bwMatch ? Number(bwMatch[1]) : 0;
      var urlLine = nextUriLine(lines, i + 1);
      if (urlLine) {
        variants.push({
          url: resolveRelativeUrl(baseUrl, urlLine),
          height: height,
          bandwidth: bandwidth,
        });
      }
    }
  }
  variants.sort(function (a, b) {
    return (b.height || b.bandwidth) - (a.height || a.bandwidth);
  });
  return variants;
}

function flowVariantLabel(url) {
  var match = String(url || "").match(/flow\.tvlogy\.to\/([a-z0-9]+)\//i);
  if (!match) {
    return "";
  }
  var variant = match[1].toLowerCase();
  if (variant.startsWith("embed")) {
    return "embed";
  }
  if (variant.startsWith("plyr")) {
    return "plyr";
  }
  if (variant.startsWith("nflix")) {
    return "nflix";
  }
  return variant;
}

function buildFlowStream(quality, size, duration, playerUrl, streamHeaders, url) {
  return {
    backend: "flow",
    kind: "hls",
    quality: quality,
    url: url,
    size: size,
    duration: duration,
    sourceTag: flowVariantLabel(playerUrl),
    headers: streamHeaders,
  };
}

// ponytail: quality from master RESOLUTION only. Skip media-playlist + segment
// size sampling (~15 range requests) — size/duration never reach Nuvio anyway
// (toNuvioStream drops duration; empty size is fine).
function resolveFlowPlayer(playerUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var streamHeaders = { Referer: playerUrl, "User-Agent": UA };
  return fetchText(fetchImpl, playerUrl, browserHeaders(refererUrl))
    .then(function (player) {
      if (!player) {
        return null;
      }
      // Scan both direct HTML and JuicyCodes-decoded output for m3u8 URLs.
      // Direct extraction works for plyr020A/nflix020A; JuicyCodes decode is
      // needed for embed020A. Some pages may have both — collect all candidates.
      var directCandidates = m3u8Candidates(player);
      var decodedCandidates = m3u8Candidates(decodeJuicyCodes(player));
      var masterUrl = directCandidates[0] || decodedCandidates[0] || "";
      if (!masterUrl) {
        return null;
      }
      return fetchText(fetchImpl, masterUrl, browserHeaders(playerUrl)).then(function (manifest) {
        var variants = parseHlsMasterPlaylist(manifest, masterUrl);
        var quality =
          variants.length > 0 && variants[0].height > 0
            ? variants[0].height + "p"
            : hlsQualityFromManifest(manifest);
        return buildFlowStream(quality, "", 0, playerUrl, streamHeaders, masterUrl);
      });
    });
}

// --- tvarticles page resolution ---

function resolveTvarticlesPage(tvarticlesUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return fetchText(fetchImpl, tvarticlesUrl, { headers: BROWSER_HEADERS })
    .then(function (page) {
      if (!page) {
        return null;
      }
      var iframeUrl = findPlayerIframe(page);
      if (!iframeUrl) {
        return null;
      }
      if (VKPRIME_RE.test(iframeUrl) || VKSPEED_RE.test(iframeUrl)) {
        return resolveVkPlayerAdapter(iframeUrl, tvarticlesUrl, { fetchImpl: fetchImpl });
      }
      if (FLOW_RE.test(iframeUrl)) {
        return resolveFlowPlayer(iframeUrl, tvarticlesUrl, { fetchImpl: fetchImpl });
      }
      return null;
    })
    .catch(function (e) {
      console.log(
        "[Desi-Serials.to] tvarticles resolution failed for " +
          tvarticlesUrl +
          ": " +
          (e && e.message),
      );
      return null;
    });
}

function resolveFromEpisodeUrls(fetchImpl, episodeUrls, request) {
  if (episodeUrls.length === 0) {
    return Promise.resolve([]);
  }
  return Promise.all(
    episodeUrls.map(function (url) {
      return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS }).catch(function (e) {
        console.log(
          "[Desi-Serials.to] episode page fetch failed for " + url + ": " + (e && e.message),
        );
        return null;
      });
    }),
  ).then(function (episodePages) {
    var allTvarticlesUrls = dedupe(
      episodePages.flatMap(function (page) {
        return page ? tvarticlesLinks(page) : [];
      }),
    );
    if (allTvarticlesUrls.length === 0) {
      return [];
    }
    return Promise.all(
      allTvarticlesUrls.map(function (url) {
        return resolveTvarticlesPage(url, { fetchImpl: fetchImpl });
      }),
    ).then(function (resolved) {
      return dedupeStreams(resolved);
    });
  });
}

// --- Main resolver ---

function resolveDesiSerials(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var archiveUrls = buildCandidateUrls(request).desiSerials;
  var searchUrls = buildSearchUrls(request);

  // Phase 1: Try the site search first — it's fast (1 request per slug variant)
  // and returns direct episode page links regardless of how deep the episode
  // is in the archive pagination.
  if (searchUrls.length > 0) {
    return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function (page) {
      var episodeUrls = episodePageCandidates(page, request);
      return episodeUrls.length > 0 ? episodeUrls : null;
    }).then(function (episodeUrls) {
      if (episodeUrls) {
        return resolveFromEpisodeUrls(fetchImpl, episodeUrls, request);
      }
      return processArchive(fetchImpl, archiveUrls, request, 0);
    });
  }

  return processArchive(fetchImpl, archiveUrls, request, 0);
}

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
      return resolveFromEpisodeUrls(fetchImpl, episodeUrls, request).then(function (streams) {
        if (streams.length > 0) {
          return streams;
        }
        return processArchive(fetchImpl, archiveUrls, request, index + 1);
      });
    });
}

// --- Layer 5: Stream formatting ---

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveDesiSerials(request, { fetchImpl: fetchImpl })
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = providerDisplayName(stream);
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[Desi-Serials.to] resolver failed: " + error.message);
      return [];
    });
}

// --- Layer 6: getStreams entry point ---

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, {
        fetchImpl: typeof fetch !== "undefined" ? fetch : null,
      });
    })
    .catch(function (error) {
      console.log("[Desi-Serials.to] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
