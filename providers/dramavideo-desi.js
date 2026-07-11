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

// src/lib/http.js
function resolveFetch(options) {
  return options && options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
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
function fetchFirstResult(fetchImpl, urls, options, select) {
  function next(index) {
    if (index >= urls.length)
      return Promise.resolve(null);
    return fetchText(fetchImpl, urls[index], options).then(function(text) {
      if (!text)
        return next(index + 1);
      var result = select(text, urls[index]);
      return result === null || result === void 0 ? next(index + 1) : result;
    });
  }
  return next(0);
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
function attrValues(markup, tags, attrs) {
  var tagAlternation = tags.join("|");
  var attrAlternation = attrs.join("|");
  var tagPattern = new RegExp("<\\s*(" + tagAlternation + ")\\b[^>]*>", "gis");
  var attrPattern = new RegExp(
    "\\b(" + attrAlternation + `)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "gi"
  );
  var values = [];
  var tag;
  while ((tag = tagPattern.exec(String(markup || ""))) !== null) {
    var attr;
    attrPattern.lastIndex = 0;
    while ((attr = attrPattern.exec(tag[0])) !== null) {
      values.push(decodeText((attr[2] || attr[3] || attr[4] || "").trim()));
    }
  }
  return dedupe(values);
}
function iframeSrcCandidates(markup) {
  return dedupe(
    attrValues(markup, ["iframe"], [
      "src",
      "data-src",
      "data-wpfc-original-src",
      "data-lazy-src",
      "data-litespeed-src"
    ])
  );
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
    candidates.unshift(candidates[0] + "-" + season);
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
      ).then(function(ep) {
        return ep;
      }, function() {
        return { air_date: "", name: "", runtime: 0 };
      });
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
function formatMbps(mbps) {
  if (mbps >= 10)
    return mbps.toFixed(0) + " Mbps";
  if (mbps >= 1)
    return mbps.toFixed(1) + " Mbps";
  return mbps.toFixed(2) + " Mbps";
}
function bitrateLabel(sizeBytes, runtimeMinutes) {
  var bytes = Number(sizeBytes);
  var minutes = Number(runtimeMinutes);
  if (!Number.isFinite(bytes) || bytes <= 0)
    return null;
  if (!Number.isFinite(minutes) || minutes <= 0)
    return null;
  return formatMbps(bytes * 8 / (minutes * 60) / 1e6);
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
  var resolution = stream.quality;
  var bitrate = stream.bandwidth ? formatMbps(stream.bandwidth / 1e6) : bitrateLabel(stream.sizeBytes, request.runtimeMinutes);
  if (stream.bandwidth && request.runtimeMinutes && !stream.size) {
    stream.size = formatBytes(stream.bandwidth * request.runtimeMinutes * 60 / 8);
  }
  var hasRes = resolution && String(resolution) !== "0" && String(resolution).toLowerCase() !== "unknown";
  var parts = [];
  if (hasRes)
    parts.push(resolution);
  if (bitrate)
    parts.push(bitrate);
  stream.quality = parts.join(" \u2022 ");
  var name = stream.name || displayBackend(stream.sourceTag);
  var title = mediaLabel(request);
  if (stream.quality)
    title += " - " + stream.quality;
  title += " " + String(stream.kind || "stream").toUpperCase();
  return {
    name,
    title,
    url: stream.url,
    quality: stream.quality,
    size: stream.size || "",
    headers: stream.headers || {}
  };
}

// src/lib/filemoon.js
function base64UrlToBytes(str) {
  var input = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  var pad = input.length % 4;
  if (pad)
    input += "====".substring(0, 4 - pad);
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = [];
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < input.length; i++) {
    var ch = input.charAt(i);
    if (ch === "=")
      break;
    var idx = chars.indexOf(ch);
    if (idx === -1)
      continue;
    buffer = buffer << 6 | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push(buffer >> bits & 255);
    }
  }
  return new Uint8Array(output);
}
function bytesToString(bytes) {
  var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  var str = "";
  var chunk = 32768;
  for (var i = 0; i < arr.length; i += chunk) {
    str += String.fromCharCode.apply(null, arr.subarray(i, Math.min(i + chunk, arr.length)));
  }
  return str;
}

// src/lib/dramavideo.js
var DRAMAVIDEO_WATCH_RE = /dramavideo\.se\/watch\?v=(\d+)/i;
var PLAYER_HOST = "https://player.dramavideo.se/";
var PLAYER_REFERER = "https://dramavideo.se/";
function isDramavideoUrl(url) {
  return DRAMAVIDEO_WATCH_RE.test(String(url || ""));
}
function extractWatchId(url) {
  var match = String(url || "").match(DRAMAVIDEO_WATCH_RE);
  return match ? match[1] : "";
}
function extractServerAttrs(html) {
  var text = String(html || "");
  var liMatch = text.match(/<li[^>]*class="linkserver"[^>]*>/i);
  if (!liMatch)
    return null;
  var liTag = liMatch[0];
  var videoMatch = liTag.match(/data-video="([^"]+)"/);
  var providerMatch = liTag.match(/data-provider="([^"]+)"/);
  if (!videoMatch || !providerMatch)
    return null;
  return { videoId: videoMatch[1], provider: providerMatch[1] };
}
function hexToBytes(hex) {
  var str = String(hex || "");
  var bytes = [];
  for (var i = 0; i < str.length; i += 2) {
    bytes.push(parseInt(str.substr(i, 2), 16));
  }
  return new Uint8Array(bytes);
}
function base64ToBytes(b64) {
  var b64url = String(b64 || "").replace(/\+/g, "-").replace(/\//g, "_");
  return base64UrlToBytes(b64url);
}
function aesCbcDecryptSubtle(encDataBase64, keyHex, ivHex) {
  var subtle = typeof crypto !== "undefined" && crypto.subtle || typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle)
    return Promise.reject(new Error("crypto.subtle not available"));
  var keyBytes = hexToBytes(keyHex);
  var ivBytes = hexToBytes(ivHex);
  var ctBytes = base64ToBytes(encDataBase64);
  return subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]).then(function(key) {
    return subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, ctBytes);
  }).then(function(decrypted) {
    return bytesToString(new Uint8Array(decrypted));
  });
}
function aesCbcDecryptCryptoJS(encDataBase64, keyHex, ivHex) {
  var CryptoJS = typeof require === "function" ? require("crypto-js") : null;
  if (!CryptoJS)
    return Promise.reject(new Error("crypto-js not available"));
  var key = CryptoJS.enc.Hex.parse(keyHex);
  var iv = CryptoJS.enc.Hex.parse(ivHex);
  var cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(encDataBase64)
  });
  var decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  return Promise.resolve(decrypted.toString(CryptoJS.enc.Utf8));
}
function aesCbcDecrypt(encDataBase64, keyHex, ivHex) {
  return aesCbcDecryptSubtle(encDataBase64, keyHex, ivHex).catch(function() {
    return aesCbcDecryptCryptoJS(encDataBase64, keyHex, ivHex);
  });
}
function parseDecryptedSources(html) {
  var text = String(html || "");
  var match = text.match(/JSON\.parse\(`(\[[^\]]+\])`\)/);
  if (!match)
    return [];
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return [];
  }
}
function decryptPlayerPage(fetchImpl, videoId, provider) {
  var playerUrl = PLAYER_HOST + "?id=" + videoId + "&sv=" + provider;
  var headers = Object.assign({}, BROWSER_HEADERS, { Referer: PLAYER_REFERER });
  return fetchText(fetchImpl, playerUrl, { headers }).then(function(html) {
    if (!html)
      return null;
    var encMatch = html.match(/encData="([^"]+)"/);
    var keyMatch = html.match(/keyHex="([^"]+)"/);
    var ivMatch = html.match(/ivHex="([^"]+)"/);
    if (!encMatch || !keyMatch || !ivMatch)
      return null;
    return aesCbcDecrypt(encMatch[1], keyMatch[1], ivMatch[1]);
  });
}
function resolveDramavideoEmbed(fetchImpl, watchUrl) {
  var watchId = extractWatchId(watchUrl);
  if (!watchId)
    return Promise.resolve([]);
  return fetchText(fetchImpl, watchUrl, { headers: BROWSER_HEADERS }).then(function(html) {
    if (!html)
      return [];
    var attrs = extractServerAttrs(html);
    if (!attrs)
      return [];
    return decryptPlayerPage(fetchImpl, attrs.videoId, attrs.provider);
  }).then(function(decryptedHtml) {
    if (!decryptedHtml)
      return [];
    var sources = parseDecryptedSources(decryptedHtml);
    return sources.filter(function(s) {
      return s.file && s.type === "hls";
    }).map(function(s) {
      var qualityMatch = (s.label || "").match(/(\d{3,4})p?/i);
      var quality = qualityMatch ? qualityMatch[1] + "p" : "720p";
      return {
        url: s.file,
        quality,
        name: "DramaVideo",
        kind: "hls",
        sourceTag: "dramavideo",
        headers: { Referer: PLAYER_HOST }
      };
    });
  }).catch(function() {
    return [];
  });
}

// src/dramavideo-desi/index.js
var SITE_BASE = "https://yehrishtakiakehlatahai.com";
var EPISODE_PATTERN = "/{slug}-{date}-episode-{num}-video/";
var SEARCH_PATH = "/?s=";
function buildEpisodeUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug)
    return [];
  var urls = [];
  for (var i = 0; i < request.slugCandidates.length; i++) {
    var path = EPISODE_PATTERN.replace("{slug}", request.slugCandidates[i]).replace("{date}", dateSlug).replace("{num}", request.episode);
    urls.push(SITE_BASE + path);
  }
  return urls;
}
function buildSearchUrl(request) {
  var query = encodeURIComponent(request.title + " episode " + request.episode);
  return SITE_BASE + SEARCH_PATH + query;
}
function extractDramavideoEmbeds(html) {
  var candidates = iframeSrcCandidates(html);
  return dedupe(candidates.filter(isDramavideoUrl));
}
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
function resolveAllEmbeds(fetchImpl, embeds) {
  return Promise.all(embeds.map(function(embedUrl) {
    return resolveDramavideoEmbed(fetchImpl, embedUrl);
  })).then(function(results) {
    var all = [];
    for (var i = 0; i < results.length; i++) {
      all = all.concat(results[i]);
    }
    return all;
  });
}
function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var urls = buildEpisodeUrls(request);
  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function(html) {
    var embeds = extractDramavideoEmbeds(html);
    if (embeds.length === 0)
      return null;
    return embeds;
  }).then(function(embeds) {
    if (embeds) {
      return resolveAllEmbeds(fetchImpl, embeds);
    }
    var searchUrl = buildSearchUrl(request);
    return fetchText(fetchImpl, searchUrl, { headers: BROWSER_HEADERS }).then(function(html) {
      if (!html)
        return [];
      var episodeLinks = extractEpisodeLinks(html, request.episode);
      if (episodeLinks.length === 0)
        return [];
      return fetchFirstResult(fetchImpl, episodeLinks, { headers: BROWSER_HEADERS }, function(epHtml) {
        var searchEmbeds = extractDramavideoEmbeds(epHtml);
        return searchEmbeds.length > 0 ? searchEmbeds : null;
      }).then(function(searchEmbeds) {
        if (!searchEmbeds)
          return [];
        return resolveAllEmbeds(fetchImpl, searchEmbeds);
      });
    });
  }).then(function(resolved) {
    return dedupeStreams(resolved).map(function(stream) {
      stream.name = "DramaVideo Desi";
      return toNuvioStream(request, stream);
    });
  }).catch(function(error) {
    console.log("[DramaVideo Desi] resolver failed: " + error.message);
    return [];
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY }).then(function(request) {
    return getStreamsForRequest(request, { fetchImpl: typeof fetch !== "undefined" ? fetch : null });
  }).catch(function(error) {
    console.log("[DramaVideo Desi] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
