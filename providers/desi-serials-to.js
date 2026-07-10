// src/lib/constants.js
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var BROWSER_HEADERS = { "User-Agent": UA };
var MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];
var CHANNEL_SLUGS = {
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
  "starplus": ["star-plus"],
  "zee tv": ["zee-tv"]
};
var VKSPEED_HOSTS = ["vkspeed.com", "vkcdn5.com", "vkcdn6.com", "vkcdn7.com"];
var VKPRIME_HOSTS = ["vkprime.com"];

// src/lib/http.js
function resolveFetch(options) {
  return options && options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
}
function browserHeaders(referer) {
  return { headers: Object.assign({}, BROWSER_HEADERS, { Referer: referer }) };
}
function fetchText(fetchImpl, url, options) {
  return fetchImpl(url, options || {}).then(function(response) {
    if (!response || response.ok === false) {
      return null;
    }
    return response.text();
  }).catch(function() {
    return null;
  });
}
function fetchJson(fetchImpl, url) {
  return fetchImpl(url).then(function(response) {
    if (!response || response.ok === false) {
      var status = response ? response.status : "unknown";
      throw new Error("TMDB request failed: " + status);
    }
    return response.json();
  });
}
function fetchContentLength(fetchImpl, url, headers) {
  return fetchImpl(url, { method: "GET", headers: Object.assign({}, headers || {}, { Range: "bytes=0-0" }) }).then(function(response) {
    if (!response || response.ok === false)
      return 0;
    var cr = response.headers && response.headers.get("content-range") || "";
    var match = cr.match(/\/(\d+)$/);
    if (match) {
      if (typeof response.arrayBuffer === "function") {
        response.arrayBuffer().catch(function() {
        });
      }
      return Number(match[1]);
    }
    return Number(response.headers && response.headers.get("content-length") || 0) || 0;
  }).catch(function() {
    return 0;
  });
}

// src/lib/html.js
function dedupe(values) {
  var seen = /* @__PURE__ */ new Set();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var value = values[i];
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}
function dedupeStreams(streams) {
  var seen = /* @__PURE__ */ new Set();
  var out = [];
  for (var i = 0; i < streams.length; i++) {
    var stream = streams[i];
    if (!stream || !stream.url)
      continue;
    var key = stream.url + "\0" + (stream.sourceTag || "");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(stream);
    }
  }
  return out;
}
function isPlaceholderUrl(url) {
  var lower = String(url || "").toLowerCase();
  return lower.indexOf("/ads/") !== -1 || lower.indexOf("127.0.0.1") !== -1;
}
function embedHostRegex(hosts, pathPattern) {
  var escaped = hosts.map(function(h) {
    return h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(
    "^https://(?:www\\.)?(?:" + escaped.join("|") + ")/" + pathPattern + "$",
    "i"
  );
}
function nextUriLine(lines, from) {
  for (var j = from; j < lines.length; j += 1) {
    var line = lines[j].trim();
    if (line && line.charAt(0) !== "#") {
      return line;
    }
  }
  return "";
}
function decodeText(raw) {
  var text = String(raw || "").replace(/&amp;/gi, "&").replace(/&#038;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
  var replacements = [
    [/\\\//gi, "/"],
    [/\\u0026/gi, "&"],
    [/\\u003d/gi, "="],
    [/\\u003f/gi, "?"],
    [/\\u002f/gi, "/"],
    [/\\x26/gi, "&"],
    [/\\x3d/gi, "="],
    [/\\x3f/gi, "?"],
    [/\\x2f/gi, "/"]
  ];
  for (var i = 0; i < replacements.length; i++) {
    text = text.replace(replacements[i][0], replacements[i][1]);
  }
  return text.replace(/&amp;/gi, "&").replace(/&#038;/gi, "&");
}
function mediaCandidates(raw, extension) {
  var text = decodeText(raw);
  var pattern = new RegExp(
    `https?://[^\\s'\\"<>\\\\,}\\]]+\\.` + extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + `(?:\\?[^\\s'\\"<>\\\\}\\]]*)?`,
    "gi"
  );
  var matches = [];
  var m;
  while ((m = pattern.exec(text)) !== null) {
    matches.push(m[0].replace(/[.;)]+$/g, ""));
  }
  return dedupe(matches);
}
function mp4Candidates(raw) {
  return mediaCandidates(raw, "mp4");
}
function m3u8Candidates(raw) {
  return mediaCandidates(raw, "m3u8");
}
function attrValues(markup, tags, attrs) {
  var tagAlternation = tags.join("|");
  var attrAlternation = attrs.join("|");
  var tagPattern = new RegExp("<\\s*(" + tagAlternation + ")\\b[^>]*>", "gis");
  var attrPattern = new RegExp(
    "\\b(" + attrAlternation + `)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  var values = [];
  var tag;
  while ((tag = tagPattern.exec(String(markup || ""))) !== null) {
    var attr = tag[0].match(attrPattern);
    if (attr) {
      values.push(decodeText((attr[2] || attr[3] || attr[4] || "").trim()));
    }
  }
  return dedupe(values);
}
function links(markup) {
  return attrValues(markup, ["a", "link", "area"], ["href"]);
}
function iframeSrcCandidates(markup) {
  return dedupe(
    attrValues(markup, ["iframe"], [
      "src",
      "data-src",
      "data-wpfc-original-src",
      "data-lazy-src"
    ])
  );
}
function resolveRelativeUrl(baseUrl, relative) {
  try {
    return new URL(relative, baseUrl).toString();
  } catch (e) {
    return relative;
  }
}

// src/lib/tmdb.js
function tmdbUrl(path, tmdbApiKey) {
  var separator = path.indexOf("?") !== -1 ? "&" : "?";
  return TMDB_BASE + path + separator + "api_key=" + encodeURIComponent(tmdbApiKey);
}
function normalizeTitle(title) {
  return String(title || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function slugCandidates(title) {
  var base = normalizeTitle(title);
  if (!base)
    return [];
  var candidates = [base];
  if (base.indexOf("aa") !== -1) {
    candidates.push(base.replace(/aa/g, "a"));
  }
  if (base.indexOf("-") !== -1) {
    var parts = base.split("-").filter(function(p) {
      return p.length > 0;
    });
    if (parts.length > 1) {
      var abbr = parts.map(function(p) {
        return p.charAt(0);
      }).join("");
      candidates.push(abbr);
      candidates.push(parts.join(""));
    }
  }
  return dedupe(candidates);
}
function requestSlugCandidates(title, season) {
  var candidates = slugCandidates(title);
  if (season > 1 && candidates.length > 0) {
    candidates.push(candidates[0] + "-" + season);
  }
  return dedupe(candidates);
}
function channelSlugCandidates(networks) {
  var candidates = [];
  for (var i = 0; i < (networks || []).length; i++) {
    var key = String(networks[i] || "").trim().toLowerCase();
    if (CHANNEL_SLUGS[key]) {
      for (var j = 0; j < CHANNEL_SLUGS[key].length; j++) {
        candidates.push(CHANNEL_SLUGS[key][j]);
      }
    }
  }
  return dedupe(candidates);
}
function episodeDateSlug(isoDate) {
  var match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match)
    return "";
  var day = Number(match[3]);
  var suffix = day % 100 >= 10 && day % 100 <= 20 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";
  var month = MONTHS[Number(match[2]) - 1];
  return day + suffix + "-" + month + "-" + match[1];
}
function buildMediaRequest(tmdbId, mediaType, season, episode, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var tmdbApiKey = options.tmdbApiKey || TMDB_API_KEY;
  if (!tmdbApiKey) {
    return Promise.reject(new Error("TMDB API key is required"));
  }
  if (mediaType === "tv") {
    var tvInfo = null;
    return fetchJson(fetchImpl, tmdbUrl("/tv/" + tmdbId, tmdbApiKey)).then(function(tv) {
      tvInfo = tv;
      return fetchJson(
        fetchImpl,
        tmdbUrl("/tv/" + tmdbId + "/season/" + season + "/episode/" + episode, tmdbApiKey)
      );
    }).then(function(ep) {
      var title = tvInfo.name || tvInfo.original_name || "";
      var networkCandidates = channelSlugCandidates(
        (tvInfo.networks || []).map(function(network) {
          return network.name;
        })
      );
      return {
        title,
        mediaType,
        season,
        episode,
        airDate: ep.air_date || "",
        episodeTitle: ep.name || "",
        networkCandidates,
        runtimeMinutes: Number(ep.runtime || tvInfo.episode_run_time && tvInfo.episode_run_time[0] || 0) || null,
        slugCandidates: requestSlugCandidates(title, season),
        fallbackChannelSlugs: dedupe(Object.values(CHANNEL_SLUGS).flat())
      };
    });
  }
  if (mediaType === "movie") {
    return fetchJson(fetchImpl, tmdbUrl("/movie/" + tmdbId, tmdbApiKey)).then(function(movie) {
      var title = movie.title || movie.original_title || "";
      var releaseDate = movie.release_date || "";
      var airYear = releaseDate ? releaseDate.substring(0, 4) : "";
      return {
        title,
        mediaType,
        season: null,
        episode: null,
        airDate: releaseDate,
        airYear,
        runtimeMinutes: Number(movie.runtime || 0) || null,
        slugCandidates: slugCandidates(title)
      };
    });
  }
  return Promise.reject(new Error("Unsupported media type: " + mediaType));
}

// src/lib/packer.js
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decodeBase64(raw) {
  var input = String(raw || "").replace(/[^A-Za-z0-9+/]/g, "");
  var output = "";
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < input.length; i++) {
    var idx = B64_CHARS.indexOf(input.charAt(i));
    if (idx === -1) {
      continue;
    }
    buffer = buffer << 6 | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode(buffer >> bits & 255);
    }
  }
  return output;
}
function packerEncode(n, base) {
  if (n === 0)
    return "0";
  var out = "";
  var value = n;
  while (value > 0) {
    var r = value % base;
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
  var match = String(blob || "").match(
    /eval\(function\(p,a,c,k,e,(?:d|r)\).*?\}\s*\(\s*'(.*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)/s
  );
  if (!match)
    return "";
  var out = match[1].replace(/\\'/g, "'");
  var base = Number(match[2]);
  var count = Number(match[3]);
  var keys = match[4].replace(/\\'/g, "'").split("|");
  for (var i = count - 1; i >= 0; i -= 1) {
    if (!keys[i])
      continue;
    var token = packerEncode(i, base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp("\\b" + token + "\\b", "g"), keys[i]);
  }
  return out;
}
function decodeJuicyCodes(html) {
  var match = String(html || "").match(/JuicyCodes\.Run\(([^)]+)\)/s);
  if (!match) {
    return "";
  }
  var fragments = match[1].match(/"([^"]*)"|'([^']*)'/g);
  if (!fragments) {
    return "";
  }
  var payload = "";
  for (var i = 0; i < fragments.length; i++) {
    payload += fragments[i].replace(/^["']|["']$/g, "");
  }
  return unpack(decodeBase64(payload));
}

// src/lib/vkplayer.js
function qualityNearUrl(text, url) {
  var index = text.indexOf(url);
  if (index === -1)
    return 0;
  var before = text.substring(Math.max(0, index - 80), index);
  var after = text.substring(index, index + 120);
  var matches = (before + after).match(/(\d{3,4})p?/gi) || [];
  if (matches.length === 0)
    return 0;
  return Number(matches[matches.length - 1]);
}
function jwPlayerSourceQualities(raw) {
  var text = decodeText(raw);
  var map = /* @__PURE__ */ new Map();
  var re = /\{\s*(?:file|src)\s*:\s*["']([^"']+)["']\s*,\s*(?:label|quality|res)\s*:\s*["']?(\d{3,4})p?["']?\s*[^}]*\}/gi;
  var m;
  while ((m = re.exec(text)) !== null) {
    map.set(m[1], Number(m[2]));
  }
  var re2 = /\{\s*(?:label|quality|res)\s*:\s*["']?(\d{3,4})p?["']?\s*,\s*(?:file|src)\s*:\s*["']([^"']+)["']\s*[^}]*\}/gi;
  while ((m = re2.exec(text)) !== null) {
    if (!map.has(m[2])) {
      map.set(m[2], Number(m[1]));
    }
  }
  return map;
}
function rankedMp4Candidates(raw) {
  var text = decodeText(raw);
  var jwMap = jwPlayerSourceQualities(raw);
  return mp4Candidates(text).map(function(url) {
    return { url, quality: jwMap.get(url) || qualityNearUrl(text, url) || 0 };
  }).sort(function(a, b) {
    return b.quality - a.quality;
  });
}
function resolveVkPlayer(embedUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return fetchText(fetchImpl, embedUrl, browserHeaders(refererUrl)).then(function(playerHtml) {
    if (!playerHtml)
      return [];
    var decoded = unpack(playerHtml);
    var payload = [playerHtml, decoded].filter(Boolean).join("\n");
    var sources = rankedMp4Candidates(payload);
    return sources.map(function(src) {
      return {
        url: src.url,
        quality: "unknown",
        kind: "mp4",
        headers: { Referer: embedUrl, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      };
    });
  }).catch(function() {
    return [];
  });
}

// src/lib/format.js
function formatBytes(bytes) {
  var value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0)
    return "";
  var units = ["B", "KB", "MB", "GB", "TB"];
  var size = value;
  var index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  var digits = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2;
  return size.toFixed(digits) + " " + units[index];
}
function estimateQualityFromSize(sizeBytes, runtimeMinutes) {
  var bytes = Number(sizeBytes);
  var minutes = Number(runtimeMinutes);
  if (!Number.isFinite(bytes) || bytes <= 0)
    return null;
  if (!Number.isFinite(minutes) || minutes <= 0)
    return null;
  var mbPerMin = bytes / (1024 * 1024) / minutes;
  if (mbPerMin < 4)
    return "360p";
  if (mbPerMin > 20)
    return "1080p";
  return "720p";
}
function displayBackend(backend) {
  return String(backend || "source");
}
function episodeLabel(request) {
  var season = String(request.season || 0).padStart(2, "0");
  var episode = String(request.episode || 0).padStart(2, "0");
  var parts = [request.title + " S" + season + "E" + episode];
  var epTitle = String(request.episodeTitle || "").trim();
  if (epTitle && !new RegExp("^episode\\s+" + request.episode + "$", "i").test(epTitle)) {
    parts.push(epTitle);
  }
  if (request.runtimeMinutes) {
    parts.push(request.runtimeMinutes + "m");
  }
  return parts.join(" - ");
}
function movieLabel(request) {
  var parts = [request.title];
  if (request.airYear) {
    parts.push("(" + request.airYear + ")");
  }
  if (request.runtimeMinutes) {
    parts.push(request.runtimeMinutes + "m");
  }
  return parts.join(" - ");
}
function mediaLabel(request) {
  if (request.mediaType === "movie")
    return movieLabel(request);
  return episodeLabel(request);
}
function toNuvioStream(request, stream) {
  var name = stream.name || displayBackend(stream.sourceTag);
  var title = mediaLabel(request) + " - " + stream.quality + " " + String(stream.kind || "stream").toUpperCase();
  return {
    name,
    title,
    url: stream.url,
    quality: stream.quality,
    size: stream.size || "",
    headers: stream.headers || {}
  };
}

// src/desi-serials-to/index.js
var SITE_BASE = "https://www.desi-serials.to";
var SEARCH_PATH = "/?s=";
var WATCH_PATH = "/watch-online/";
var ARCHIVE_PAGE_PATH = "page/";
var TVARTICLES_HOST = "tvarticles.org";
var FLOW_HOSTS = ["flow.tvlogy.to"];
var DESI_SERIALS_HOST_RE = new RegExp(
  "^https://(?:www\\.)?desi-serials\\.to/",
  "i"
);
var TVARTICLES_RE = new RegExp(
  "^https://" + TVARTICLES_HOST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/vidd\\.php\\?id=\\d+",
  "i"
);
var VKPRIME_RE = embedHostRegex(VKPRIME_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var VKSPEED_RE = embedHostRegex(VKSPEED_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var FLOW_RE = embedHostRegex(FLOW_HOSTS, "[A-Za-z0-9/_-]+/?");
function providerDisplayName(stream) {
  var backend = String(stream.backend || "source").replace(/(^|[-_\s]+)([a-z])/g, function(_match, prefix, ch) {
    return prefix + ch.toUpperCase();
  }).replace(/[-_]+/g, "");
  var name = "Desi-Serials.to " + backend;
  if (stream.sourceTag) {
    name += " (" + stream.sourceTag + ")";
  }
  return name;
}
function buildCandidateUrls(request) {
  var channels = request.networkCandidates && request.networkCandidates.length > 0 ? request.networkCandidates : request.fallbackChannelSlugs;
  var urls = [];
  for (var i = 0; i < channels.length; i++) {
    var channel = channels[i];
    var slugs = request.slugCandidates || [];
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
  var dateQuery = dateSlug.replace(/-/g, " ");
  var slugs = request.slugCandidates || [];
  var urls = [];
  for (var i = 0; i < slugs.length; i++) {
    urls.push(
      SITE_BASE + SEARCH_PATH + encodeURIComponent(slugs[i] + " " + dateQuery).replace(/%20/g, "+")
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
    links(markup).filter(function(href) {
      if (!DESI_SERIALS_HOST_RE.test(href)) {
        return false;
      }
      if (!href.toLowerCase().includes(dateSlug)) {
        return false;
      }
      return slugs.some(function(slug) {
        return href.toLowerCase().includes(slug);
      });
    })
  );
}
function tvarticlesLinks(markup) {
  return dedupe(
    links(markup).filter(function(href) {
      return TVARTICLES_RE.test(href);
    })
  );
}
function findPlayerIframe(markup) {
  return iframeSrcCandidates(markup).find(function(href) {
    return VKPRIME_RE.test(href) || VKSPEED_RE.test(href) || FLOW_RE.test(href);
  }) || "";
}
function resolveVkPlayerAdapter(embedUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var runtimeMinutes = options.runtimeMinutes || 0;
  return resolveVkPlayer(embedUrl, refererUrl, { fetchImpl }).then(function(sources) {
    if (!sources || sources.length === 0) {
      return null;
    }
    var real = sources.filter(function(entry) {
      return !isPlaceholderUrl(entry.url);
    });
    if (real.length === 0) {
      return null;
    }
    var best = real[0];
    var headers = { Referer: embedUrl, "User-Agent": UA };
    var backend = embedUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
    var stream = {
      backend,
      kind: "mp4",
      quality: best.quality || "unknown",
      url: best.url,
      size: "",
      duration: 0,
      sourceTag: "",
      headers
    };
    return fetchContentLength(fetchImpl, best.url, headers).then(function(sizeBytes) {
      stream.size = formatBytes(sizeBytes);
      var estimated = estimateQualityFromSize(sizeBytes, runtimeMinutes);
      if (estimated)
        stream.quality = estimated;
      return stream;
    });
  });
}
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
      var bandwidth = avgBwMatch ? Number(avgBwMatch[1]) : bwMatch ? Number(bwMatch[1]) : 0;
      var urlLine = nextUriLine(lines, i + 1);
      if (urlLine) {
        variants.push({
          url: resolveRelativeUrl(baseUrl, urlLine),
          height,
          bandwidth
        });
      }
    }
  }
  variants.sort(function(a, b) {
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
    quality,
    url,
    size,
    duration,
    sourceTag: flowVariantLabel(playerUrl),
    headers: streamHeaders
  };
}
function resolveFlowPlayer(playerUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var streamHeaders = { Referer: playerUrl, "User-Agent": UA };
  return fetchText(fetchImpl, playerUrl, browserHeaders(refererUrl)).then(function(player) {
    if (!player) {
      return null;
    }
    var directCandidates = m3u8Candidates(player);
    var decodedCandidates = m3u8Candidates(decodeJuicyCodes(player));
    var masterUrl = directCandidates[0] || decodedCandidates[0] || "";
    if (!masterUrl) {
      return null;
    }
    return fetchText(fetchImpl, masterUrl, browserHeaders(playerUrl)).then(function(manifest) {
      var variants = parseHlsMasterPlaylist(manifest, masterUrl);
      var quality = variants.length > 0 && variants[0].height > 0 ? variants[0].height + "p" : hlsQualityFromManifest(manifest);
      return buildFlowStream(quality, "", 0, playerUrl, streamHeaders, masterUrl);
    });
  });
}
function resolveTvarticlesPage(tvarticlesUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var runtimeMinutes = options.runtimeMinutes || 0;
  return fetchText(fetchImpl, tvarticlesUrl, { headers: BROWSER_HEADERS }).then(function(page) {
    if (!page) {
      return null;
    }
    var iframeUrl = findPlayerIframe(page);
    if (!iframeUrl) {
      return null;
    }
    if (VKPRIME_RE.test(iframeUrl) || VKSPEED_RE.test(iframeUrl)) {
      return resolveVkPlayerAdapter(iframeUrl, tvarticlesUrl, { fetchImpl, runtimeMinutes });
    }
    if (FLOW_RE.test(iframeUrl)) {
      return resolveFlowPlayer(iframeUrl, tvarticlesUrl, { fetchImpl });
    }
    return null;
  }).catch(function(e) {
    console.log(
      "[Desi-Serials.to] tvarticles resolution failed for " + tvarticlesUrl + ": " + (e && e.message)
    );
    return null;
  });
}
function resolveFromEpisodeUrls(fetchImpl, episodeUrls, request) {
  if (episodeUrls.length === 0) {
    return Promise.resolve([]);
  }
  return Promise.all(
    episodeUrls.map(function(url) {
      return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS }).catch(function(e) {
        console.log(
          "[Desi-Serials.to] episode page fetch failed for " + url + ": " + (e && e.message)
        );
        return null;
      });
    })
  ).then(function(episodePages) {
    var allTvarticlesUrls = dedupe(
      episodePages.flatMap(function(page) {
        return page ? tvarticlesLinks(page) : [];
      })
    );
    if (allTvarticlesUrls.length === 0) {
      return [];
    }
    return Promise.all(
      allTvarticlesUrls.map(function(url) {
        return resolveTvarticlesPage(url, { fetchImpl, runtimeMinutes: request.runtimeMinutes || 0 });
      })
    ).then(function(resolved) {
      return dedupeStreams(resolved);
    });
  });
}
function resolveDesiSerials(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var archiveUrls = buildCandidateUrls(request).desiSerials;
  var searchUrls = buildSearchUrls(request);
  if (searchUrls.length > 0) {
    return Promise.all(
      searchUrls.map(function(url) {
        return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS });
      })
    ).then(function(searchPages) {
      var episodeUrls = dedupe(
        searchPages.flatMap(function(page) {
          return page ? episodePageCandidates(page, request) : [];
        })
      );
      if (episodeUrls.length > 0) {
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
  return fetchText(fetchImpl, archiveUrls[index], { headers: BROWSER_HEADERS }).then(function(archive) {
    if (!archive) {
      return processArchive(fetchImpl, archiveUrls, request, index + 1);
    }
    var episodeUrls = episodePageCandidates(archive, request);
    if (episodeUrls.length === 0) {
      return processArchive(fetchImpl, archiveUrls, request, index + 1);
    }
    return resolveFromEpisodeUrls(fetchImpl, episodeUrls, request).then(function(streams) {
      if (streams.length > 0) {
        return streams;
      }
      return processArchive(fetchImpl, archiveUrls, request, index + 1);
    });
  });
}
function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveDesiSerials(request, { fetchImpl }).then(function(resolved) {
    return dedupeStreams(resolved).map(function(stream) {
      stream.name = providerDisplayName(stream);
      return toNuvioStream(request, stream);
    });
  }).catch(function(error) {
    console.log("[Desi-Serials.to] resolver failed: " + error.message);
    return [];
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY }).then(function(request) {
    return getStreamsForRequest(request, {
      fetchImpl: typeof fetch !== "undefined" ? fetch : null
    });
  }).catch(function(error) {
    console.log("[Desi-Serials.to] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
