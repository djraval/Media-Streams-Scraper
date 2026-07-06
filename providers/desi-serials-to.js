// Desi-Serials.to Nuvio provider — single-file scraper.
// Resolves Indian TV episodes from desi-serials.to via VkPrime (MP4) and Flow (HLS) players.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe";

const UA = (
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
);
const BROWSER_HEADERS = { "User-Agent": UA };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const CHANNEL_SLUGS = {
  "& tv": ["and-tv"],
  "&tv": ["and-tv"],
  "and tv": ["and-tv"],
  "colors": ["color-tv-hd", "colors-tv"],
  "colors tv": ["color-tv-hd", "colors-tv"],
  "dangal tv": ["dangal-tv"],
  "sab tv": ["sab-tv-hd", "sab-tv"],
  "sony sab": ["sab-tv-hd", "sab-tv"],
  "sony tv": ["sony-tv"],
  "star bharat": ["star-bharat"],
  "star plus": ["star-plus"],
  "zee tv": ["zee-tv"],
};

const DESI_SERIALS_HOST_RE = /^https:\/\/www\.desi-serials\.to\//i;
const TVARTICLES_RE = /^https:\/\/tvarticles\.org\/vidd\.php\?id=\d+/i;
const VKPRIME_RE = /^https:\/\/vkprime\.com\/embed-[A-Za-z0-9-]+\.html$/i;
const FLOW_RE = /^https:\/\/flow\.tvlogy\.to\/[A-Za-z0-9/_-]+\/?$/i;
const VKSPEED_RE = /^https:\/\/vkspeed\.com\/embed-[A-Za-z0-9-]+\.html$/i;

function isPlaceholderUrl(url) {
  var lower = String(url || "").toLowerCase();
  return lower.indexOf("/ads/") !== -1 || lower.indexOf("127.0.0.1") !== -1;
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function decodeText(raw) {
  let text = String(raw || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  const replacements = [
    [/\\\//gi, "/"],
    [/\\u0026/gi, "&"],
    [/\\u003d/gi, "="],
    [/\\u003f/gi, "?"],
    [/\\u002f/gi, "/"],
    [/\\x26/gi, "&"],
    [/\\x3d/gi, "="],
    [/\\x3f/gi, "?"],
    [/\\x2f/gi, "/"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&");
}

function mediaCandidates(raw, extension) {
  const text = decodeText(raw);
  const pattern = new RegExp(
    "https?://[^\\s'\\\"<>\\\\,}\\]]+\\." +
      extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(?:\\?[^\\s'\\\"<>\\\\}\\]]*)?",
    "gi",
  );
  return dedupe(
    Array.from(text.matchAll(pattern), (match) => (
      match[0].replace(/[.;)]+$/g, "")
    )),
  );
}

function mp4Candidates(raw) {
  return mediaCandidates(raw, "mp4");
}

function m3u8Candidates(raw) {
  return mediaCandidates(raw, "m3u8");
}

function attrValues(markup, tags, attrs) {
  const tagAlternation = tags.join("|");
  const attrAlternation = attrs.join("|");
  const tagPattern = new RegExp(`<\\s*(${tagAlternation})\\b[^>]*>`, "gis");
  const attrPattern = new RegExp(
    `\\b(${attrAlternation})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const values = [];
  for (const tag of String(markup || "").matchAll(tagPattern)) {
    const attr = tag[0].match(attrPattern);
    if (attr) {
      values.push(decodeText((attr[2] || attr[3] || attr[4] || "").trim()));
    }
  }
  return dedupe(values);
}

function links(markup) {
  return attrValues(markup, ["a", "link", "area"], ["href"]);
}

function iframes(markup) {
  return attrValues(markup, ["iframe"], ["src"]);
}

function packerEncode(n, base) {
  if (n === 0) {
    return "0";
  }
  let out = "";
  let value = n;
  while (value > 0) {
    const r = value % base;
    if (r < 10) {
      out = String.fromCharCode(48 + r) + out;
    } else if (r < 36) {
      out = String.fromCharCode(87 + r) + out;
    } else {
      out = String.fromCharCode(29 + r) + out;
    }
    value = Math.floor(value / base);
  }
  return out;
}

function unpack(blob) {
  const match = String(blob || "").match(
    /eval\(function\(p,a,c,k,e,(?:d|r)\).*?\}\s*\(\s*'(?<p>.*?)'\s*,\s*(?<a>\d+)\s*,\s*(?<c>\d+)\s*,\s*'(?<k>.*?)'\.split\('\|'\)/s,
  );
  if (!match || !match.groups) {
    return "";
  }

  let out = match.groups.p.replace(/\\'/g, "'");
  const base = Number(match.groups.a);
  const count = Number(match.groups.c);
  const keys = match.groups.k.replace(/\\'/g, "'").split("|");

  for (let i = count - 1; i >= 0; i -= 1) {
    if (!keys[i]) {
      continue;
    }
    const token = packerEncode(i, base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${token}\\b`, "g"), keys[i]);
  }
  return out;
}

var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(raw) {
  var input = String(raw || "").replace(/[^A-Za-z0-9+/]/g, "");
  var output = "";
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < input.length; i++) {
    var idx = B64_CHARS.indexOf(input.charAt(i));
    if (idx === -1) { continue; }
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function decodeJuicyCodes(html) {
  var match = String(html || "").match(/JuicyCodes\.Run\(([^)]+)\)/s);
  if (!match) { return ""; }
  var fragments = match[1].match(/"([^"]*)"|'([^']*)'/g);
  if (!fragments) { return ""; }
  var payload = "";
  for (var i = 0; i < fragments.length; i++) {
    payload += fragments[i].replace(/^["']|["']$/g, "");
  }
  return unpack(decodeBase64(payload));
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const digits = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[index]}`;
}

function normalizeTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugCandidates(title) {
  const base = normalizeTitle(title);
  if (!base) {
    return [];
  }
  const candidates = [base];
  if (base.includes("aa")) {
    candidates.push(base.replace(/aa/g, "a"));
  }
  return dedupe(candidates);
}

function requestSlugCandidates(title, season) {
  const candidates = slugCandidates(title);
  if (season > 1 && candidates.length > 0) {
    candidates.push(`${candidates[0]}-${season}`);
  }
  return dedupe(candidates);
}

function channelSlugCandidates(networks) {
  const candidates = [];
  for (const network of networks || []) {
    const key = String(network || "").trim().toLowerCase();
    if (CHANNEL_SLUGS[key]) {
      candidates.push(...CHANNEL_SLUGS[key]);
    }
  }
  return dedupe(candidates);
}

function episodeDateSlug(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  const day = Number(match[3]);
  const suffix = day % 100 >= 10 && day % 100 <= 20
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  const month = MONTHS[Number(match[2]) - 1];
  return `${day}${suffix}-${month}-${match[1]}`;
}

function fetchJson(fetchImpl, url) {
  return fetchImpl(url).then(function (response) {
    if (!response || response.ok === false) {
      const status = response ? response.status : "unknown";
      throw new Error("TMDB request failed: " + status);
    }
    return response.json();
  });
}

function tmdbUrl(path, tmdbApiKey) {
  const separator = path.includes("?") ? "&" : "?";
  return TMDB_BASE + path + separator + "api_key=" + encodeURIComponent(tmdbApiKey);
}

function buildMediaRequest(tmdbId, mediaType, season, episode, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const tmdbApiKey = options.tmdbApiKey;
  if (!tmdbApiKey) {
    return Promise.reject(new Error("TMDB API key is required"));
  }
  if (mediaType !== "tv") {
    return Promise.reject(new Error("Desi-Serials.to supports tv episodes only"));
  }
  const FALLBACK_CHANNEL_SLUGS = dedupe(Object.values(CHANNEL_SLUGS).flat());
  let tvInfo = null;
  return fetchJson(fetchImpl, tmdbUrl("/tv/" + tmdbId, tmdbApiKey))
    .then(function (tv) {
      tvInfo = tv;
      return fetchJson(
        fetchImpl,
        tmdbUrl("/tv/" + tmdbId + "/season/" + season + "/episode/" + episode, tmdbApiKey),
      );
    })
    .then(function (ep) {
      const title = tvInfo.name || tvInfo.original_name || "";
      const networkCandidates = channelSlugCandidates(
        (tvInfo.networks || []).map(function (network) { return network.name; }),
      );
      return {
        title: title,
        mediaType: mediaType,
        season: season,
        episode: episode,
        airDate: ep.air_date || "",
        episodeTitle: ep.name || "",
        networkCandidates: networkCandidates,
        runtimeMinutes: Number(ep.runtime || (tvInfo.episode_run_time && tvInfo.episode_run_time[0]) || 0) || null,
        slugCandidates: requestSlugCandidates(title, season),
        fallbackChannelSlugs: FALLBACK_CHANNEL_SLUGS,
      };
    });
}

function buildCandidateUrls(request) {
  const channels = (request.networkCandidates && request.networkCandidates.length > 0)
    ? request.networkCandidates
    : request.fallbackChannelSlugs;
  const urls = [];
  for (const channel of channels) {
    for (const slug of request.slugCandidates || []) {
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/");
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/page/2/");
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/page/3/");
    }
  }
  return { desiSerials: dedupe(urls) };
}

function fetchText(fetchImpl, url, options) {
  return fetchImpl(url, options || {})
    .then(function (response) {
      if (!response || response.ok === false) {
        return null;
      }
      return response.text();
    })
    .catch(function () { return null; });
}

function episodePageCandidates(markup, request) {
  const dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) {
    return [];
  }
  return dedupe(
    links(markup).filter(function (href) {
      if (!DESI_SERIALS_HOST_RE.test(href)) {
        return false;
      }
      if (!href.toLowerCase().includes(dateSlug)) {
        return false;
      }
      return (request.slugCandidates || []).some(function (slug) {
        return href.toLowerCase().includes(slug);
      });
    }),
  );
}

function tvarticlesLinks(markup) {
  return dedupe(links(markup).filter(function (href) {
    return TVARTICLES_RE.test(href);
  }));
}

function findPlayerIframe(markup) {
  return iframes(markup).find(function (href) {
    return VKPRIME_RE.test(href) || VKSPEED_RE.test(href) || FLOW_RE.test(href);
  }) || "";
}

function qualityNearUrl(text, url) {
  const index = text.indexOf(url);
  if (index === -1) {
    return null;
  }
  const after = text.slice(index, index + url.length + 160);
  const afterMatch = after.match(/\b(?:label|quality|res|resolution)['"]?\s*[:=]\s*['"]?(\d{3,4})p?\b/i)
    || after.match(/\b(\d{3,4})p\b/i);
  if (afterMatch) {
    return Number(afterMatch[1]);
  }
  const before = text.slice(Math.max(0, index - 160), index);
  const matches = [
    ...before.matchAll(/\b(?:label|quality|res|resolution)['"]?\s*[:=]\s*['"]?(\d{3,4})p?\b/gi),
    ...before.matchAll(/\b(\d{3,4})p\b/gi),
  ];
  if (matches.length === 0) {
    return null;
  }
  return Number(matches[matches.length - 1][1]);
}

function rankedMp4Candidates(raw) {
  const text = decodeText(raw);
  return mp4Candidates(text)
    .map(function (url) { return { url: url, quality: qualityNearUrl(text, url) || 0 }; })
    .sort(function (a, b) { return b.quality - a.quality; });
}

function hlsQualityFromManifest(raw) {
  var matches = String(raw || "").matchAll(/RESOLUTION=\d+x(\d{3,4})/gi);
  var max = 0;
  for (var m of matches) {
    var height = Number(m[1]);
    if (height > max) { max = height; }
  }
  return max > 0 ? max + "p" : "unknown";
}

function mp4QualityLabel(height) {
  if (!height) {
    return "unknown";
  }
  return height < 480 ? "unknown" : height + "p";
}

function fetchContentLength(fetchImpl, url, headers) {
  return fetchImpl(url, { method: "HEAD", headers: headers })
    .then(function (response) {
      if (!response || response.ok === false || !response.headers || typeof response.headers.get !== "function") {
        return 0;
      }
      return Number(response.headers.get("content-length") || 0) || 0;
    })
    .catch(function () { return 0; });
}

function resolveVkPlayer(embedUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  return fetchText(fetchImpl, embedUrl, {
    headers: Object.assign({}, BROWSER_HEADERS, { Referer: refererUrl }),
  })
    .then(function (player) {
      if (!player) {
        return null;
      }
      var payload = [player, unpack(player)].filter(Boolean).join("\n");
      var ranked = rankedMp4Candidates(payload);
      if (ranked.length === 0) {
        return null;
      }
      // Filter out placeholder URLs before picking the best quality.
      // A placeholder ranked first should not discard a real candidate ranked second.
      var real = ranked.filter(function (entry) { return !isPlaceholderUrl(entry.url); });
      if (real.length === 0) {
        return null;
      }
      var best = real[0];
      var headers = { Referer: embedUrl, "User-Agent": UA };
      var backend = embedUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
      return fetchContentLength(fetchImpl, best.url, headers).then(function (contentLength) {
        return {
          backend: backend,
          kind: "mp4",
          quality: mp4QualityLabel(best.quality),
          url: best.url,
          size: formatBytes(contentLength),
          duration: 0,
          sourceTag: "",
          headers: headers,
        };
      });
    });
}

function resolveRelativeUrl(baseUrl, relative) {
  try {
    return new URL(relative, baseUrl).toString();
  } catch (e) {
    return relative;
  }
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
      var bandwidth = avgBwMatch ? Number(avgBwMatch[1]) : (bwMatch ? Number(bwMatch[1]) : 0);
      var urlLine = "";
      for (var j = i + 1; j < lines.length; j++) {
        var next = lines[j].trim();
        if (next && !next.startsWith("#")) {
          urlLine = next;
          break;
        }
      }
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

function parseHlsMediaPlaylist(raw, baseUrl) {
  var segments = [];
  var totalDuration = 0;
  var lines = String(raw || "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.startsWith("#EXTINF:")) {
      var durMatch = line.match(/#EXTINF:([\d.]+)/i);
      var duration = durMatch ? Number(durMatch[1]) : 0;
      totalDuration += duration;
      for (var j = i + 1; j < lines.length; j++) {
        var next = lines[j].trim();
        if (next && !next.startsWith("#")) {
          segments.push({ url: resolveRelativeUrl(baseUrl, next), duration: duration });
          break;
        }
      }
    }
  }
  return { segments: segments, totalDuration: totalDuration };
}

function fetchSegmentSize(fetchImpl, url, headers) {
  // parrot.tvlogy.to and similar CDN nodes reject HEAD on segment URLs
  // (transport-level socket close), but accept GET with Range: bytes=0-0
  // and return Content-Range with the total size.
  var rangeHeaders = Object.assign({}, headers, { Range: "bytes=0-0" });
  return fetchImpl(url, { method: "GET", headers: rangeHeaders })
    .then(function (response) {
      if (!response || response.ok === false) {
        return 0;
      }
      var contentRange = (response.headers && response.headers.get("content-range")) || "";
      var match = contentRange.match(/\/(\d+)$/);
      if (match) {
        // Drain the 1-byte body so the socket can be reused.
        if (typeof response.arrayBuffer === "function") {
          response.arrayBuffer().catch(function () {});
        }
        return Number(match[1]);
      }
      return Number((response.headers && response.headers.get("content-length")) || 0) || 0;
    })
    .catch(function () { return 0; });
}

function estimateHlsSize(fetchImpl, segments, headers, bandwidth, totalDuration) {
  var count = segments.length;
  // Bitrate-based fallback: bytes ~= bandwidth (bits/s) * duration (s) / 8
  var bitrateEstimate = (bandwidth > 0 && totalDuration > 0)
    ? Math.round((bandwidth * totalDuration) / 8)
    : 0;

  if (count === 0) {
    return Promise.resolve(bitrateEstimate);
  }
  var sampleSize = Math.min(5, count);
  var sampleUrls = [];
  for (var i = 0; i < sampleSize; i++) {
    var idx = Math.floor(i * count / sampleSize);
    sampleUrls.push(segments[idx].url);
  }
  return Promise.all(
    sampleUrls.map(function (url) {
      return fetchSegmentSize(fetchImpl, url, headers);
    }),
  ).then(function (sizes) {
    var valid = sizes.filter(function (s) { return s > 0; });
    if (valid.length === 0) {
      return bitrateEstimate;
    }
    var avg = valid.reduce(function (a, b) { return a + b; }, 0) / valid.length;
    return Math.round(avg * count);
  });
}

function flowVariantLabel(url) {
  var match = String(url || "").match(/flow\.tvlogy\.to\/([a-z0-9]+)\//i);
  if (!match) {
    return "";
  }
  var variant = match[1].toLowerCase();
  if (variant.indexOf("embed") === 0) {
    return "embed";
  }
  if (variant.indexOf("plyr") === 0) {
    return "plyr";
  }
  if (variant.indexOf("nflix") === 0) {
    return "nflix";
  }
  return variant;
}

function formatDuration(seconds) {
  var total = Math.round(Number(seconds) || 0);
  if (total <= 0) {
    return "";
  }
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  if (h > 0) {
    return h + "h" + (m > 0 ? " " + m + "m" : "");
  }
  if (m > 0) {
    return m + "m" + (s > 0 ? " " + s + "s" : "");
  }
  return s + "s";
}

function resolveFlowPlayer(playerUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  var streamHeaders = { Referer: playerUrl, "User-Agent": UA };
  return fetchText(fetchImpl, playerUrl, {
    headers: Object.assign({}, BROWSER_HEADERS, { Referer: refererUrl }),
  })
    .then(function (player) {
      if (!player) {
        return null;
      }
      // Scan both direct HTML and JuicyCodes-decoded output for m3u8 URLs.
      // Direct extraction works for plyr020A/nflix020A; JuicyCodes decode is
      // needed for embed020A. Some pages may have both — collect all candidates.
      var directCandidates = m3u8Candidates(player);
      var decodedCandidates = m3u8Candidates(decodeJuicyCodes(player));
      var masterUrl = (directCandidates[0] || decodedCandidates[0] || "");
      if (!masterUrl) {
        return null;
      }
      return fetchText(fetchImpl, masterUrl, {
        headers: Object.assign({}, BROWSER_HEADERS, { Referer: playerUrl }),
      }).then(function (manifest) {
        // If this is a master playlist, fetch the highest-quality variant
        // to parse segment durations and estimate size.
        var variants = parseHlsMasterPlaylist(manifest, masterUrl);
        if (variants.length > 0) {
          var best = variants[0];
          var quality = best.height > 0 ? best.height + "p" : hlsQualityFromManifest(manifest);
          return fetchText(fetchImpl, best.url, {
            headers: Object.assign({}, BROWSER_HEADERS, { Referer: playerUrl }),
          }).then(function (variantManifest) {
            var media = parseHlsMediaPlaylist(variantManifest, best.url);
            return estimateHlsSize(fetchImpl, media.segments, streamHeaders, best.bandwidth, media.totalDuration).then(function (estimatedSize) {
              return {
                backend: "flow",
                kind: "hls",
                quality: quality,
                url: masterUrl,
                size: formatBytes(estimatedSize),
                duration: media.totalDuration,
                sourceTag: flowVariantLabel(playerUrl),
                headers: streamHeaders,
              };
            });
          }).catch(function () {
            return {
              backend: "flow",
              kind: "hls",
              quality: quality,
              url: masterUrl,
              size: "",
              duration: 0,
              sourceTag: flowVariantLabel(playerUrl),
              headers: streamHeaders,
            };
          });
        }
        // Direct media playlist (no master/variant layer)
        var media = parseHlsMediaPlaylist(manifest, masterUrl);
        return estimateHlsSize(fetchImpl, media.segments, streamHeaders, 0, media.totalDuration).then(function (estimatedSize) {
          return {
            backend: "flow",
            kind: "hls",
            quality: hlsQualityFromManifest(manifest),
            url: masterUrl,
            size: formatBytes(estimatedSize),
            duration: media.totalDuration,
            sourceTag: flowVariantLabel(playerUrl),
            headers: streamHeaders,
          };
        });
      });
    });
}

function resolveTvarticlesPage(tvarticlesUrl, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
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
        return resolveVkPlayer(iframeUrl, tvarticlesUrl, { fetchImpl: fetchImpl });
      }
      if (FLOW_RE.test(iframeUrl)) {
        return resolveFlowPlayer(iframeUrl, tvarticlesUrl, { fetchImpl: fetchImpl });
      }
      return null;
    })
    .catch(function () { return null; });
}

function resolveDesiSerials(request, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  var archiveUrls = buildCandidateUrls(request).desiSerials;

  function processArchive(index) {
    if (index >= archiveUrls.length) {
      return Promise.resolve([]);
    }
    return fetchText(fetchImpl, archiveUrls[index], { headers: BROWSER_HEADERS })
      .then(function (archive) {
        if (!archive) {
          return processArchive(index + 1);
        }
        var episodeUrls = episodePageCandidates(archive, request);
        if (episodeUrls.length === 0) {
          return processArchive(index + 1);
        }
        // Fetch all episode pages in parallel (null on failure, won't reject the batch).
        return Promise.all(
          episodeUrls.map(function (url) {
            return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS })
              .catch(function () { return null; });
          })
        ).then(function (episodePages) {
          // Collect all tvarticles links from all episode pages.
          var allTvarticlesUrls = dedupe(
            episodePages.flatMap(function (page) {
              return page ? tvarticlesLinks(page) : [];
            })
          );
          if (allTvarticlesUrls.length === 0) {
            return processArchive(index + 1);
          }
          // Resolve ALL tvarticles links in parallel.
          // resolveTvarticlesPage has its own .catch(), so a single failure
          // returns null instead of rejecting the whole Promise.all.
          return Promise.all(
            allTvarticlesUrls.map(function (url) {
              return resolveTvarticlesPage(url, { fetchImpl: fetchImpl });
            })
          ).then(function (resolved) {
            // Filter nulls and deduplicate by (url, sourceTag) so that
            // different Flow variants (embed/plyr/nflix) pointing at the
            // same underlying HLS URL are kept as distinct streams.
            var seen = new Set();
            var streams = [];
            for (var i = 0; i < resolved.length; i++) {
              var stream = resolved[i];
              if (!stream) { continue; }
              var dedupeKey = stream.url + "\0" + (stream.sourceTag || "");
              if (!seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                streams.push(stream);
              }
            }
            if (streams.length > 0) {
              return streams;
            }
            return processArchive(index + 1);
          });
        });
      });
  }

  return processArchive(0);
}

function displayBackend(backend) {
  return String(backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, function (_match, prefix, ch) { return prefix + ch.toUpperCase(); })
    .replace(/[-_]+/g, "");
}

function episodeLabel(request) {
  const season = String(request.season || 0).padStart(2, "0");
  const episode = String(request.episode || 0).padStart(2, "0");
  const parts = [request.title + " S" + season + "E" + episode];
  const episodeTitle = String(request.episodeTitle || "").trim();
  if (episodeTitle && !new RegExp("^episode\\s+" + request.episode + "$", "i").test(episodeTitle)) {
    parts.push(episodeTitle);
  }
  if (request.runtimeMinutes) {
    parts.push(request.runtimeMinutes + "m");
  }
  return parts.join(" - ");
}

function toNuvioStream(request, stream) {
  var name = "Desi-Serials.to " + displayBackend(stream.backend);
  if (stream.sourceTag) {
    name += " (" + stream.sourceTag + ")";
  }
  var title = episodeLabel(request) + " - " + stream.quality + " " + String(stream.kind || "stream").toUpperCase();
  var dur = formatDuration(stream.duration);
  if (dur) {
    title += " [" + dur + "]";
  }
  return {
    name: name,
    title: title,
    url: stream.url,
    quality: stream.quality,
    size: stream.size || "",
    headers: stream.headers || {},
  };
}

function getStreamsForRequest(request, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const seen = new Set();
  const streams = [];
  return resolveDesiSerials(request, { fetchImpl: fetchImpl })
    .then(function (resolved) {
      for (const stream of resolved) {
        if (!stream || !stream.url) {
          continue;
        }
        const dedupeKey = stream.url + "\0" + (stream.sourceTag || "");
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        streams.push(toNuvioStream(request, stream));
      }
      return streams;
    })
    .catch(function (error) {
      console.log("[Desi-Serials.to] resolver failed: " + error.message);
      return streams;
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
      console.log("[Desi-Serials.to] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
