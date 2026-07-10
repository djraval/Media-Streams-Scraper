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
function fetchBinaryViaBytes(url, headers, start, end) {
  if (typeof fetch === "undefined")
    return null;
  try {
    if (typeof Response !== "undefined" && typeof Response.prototype.bytes !== "function") {
      return null;
    }
  } catch (e) {
  }
  var rangeHeaders = Object.assign({}, headers || {}, { Range: "bytes=" + start + "-" + end });
  return fetch(url, { headers: rangeHeaders }).then(function(response) {
    if (!response || response.ok === false && response.status !== 206 && response.status !== 200) {
      return null;
    }
    if (typeof response.bytes === "function") {
      return response.bytes().then(function(u8) {
        if (u8 && u8.length >= 16) {
          return u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
        }
        return null;
      }).catch(function() {
        return null;
      });
    }
    return null;
  }).catch(function() {
    return null;
  });
}
function fetchBinaryViaAxios(url, headers, start, end) {
  try {
    var axios = require("axios");
    var config = {
      responseType: "arraybuffer",
      headers: Object.assign({}, headers || {}, { Range: "bytes=" + start + "-" + end })
    };
    return axios.get(url, config).then(function(response) {
      if (response && response.data && response.data.byteLength >= 16) {
        return new Uint8Array(response.data);
      }
      return null;
    }).catch(function() {
      return null;
    });
  } catch (e) {
    return null;
  }
}
function fetchBinaryViaFetch(url, headers, start, end) {
  if (typeof fetch === "undefined")
    return null;
  var rangeHeaders = Object.assign({}, headers || {}, {
    Range: "bytes=" + start + "-" + end
  });
  return fetch(url, { headers: rangeHeaders }).then(function(response) {
    if (!response || response.ok === false && response.status !== 206 && response.status !== 200) {
      return null;
    }
    if (typeof response.arrayBuffer === "function") {
      return response.arrayBuffer();
    }
    return null;
  }).then(function(buffer) {
    if (buffer && buffer.byteLength >= 16) {
      return new Uint8Array(buffer);
    }
    return null;
  }).catch(function() {
    return null;
  });
}
function fetchBinaryRange(url, headers, start, end) {
  var p = fetchBinaryViaBytes(url, headers, start, end);
  if (!p)
    p = Promise.resolve(null);
  return p.then(function(result) {
    if (result)
      return result;
    var ap = fetchBinaryViaAxios(url, headers, start, end);
    return ap || Promise.resolve(null);
  }).then(function(result) {
    if (result)
      return result;
    var fp = fetchBinaryViaFetch(url, headers, start, end);
    return fp || Promise.resolve(null);
  }).then(function(result) {
    return result || null;
  });
}
function fetchBinary(url, headers, rangeBytes) {
  var end = (rangeBytes || 65536) - 1;
  return fetchBinaryRange(url, headers, 0, end);
}
function fetchFileSize(url, headers) {
  var rangeHeaders = Object.assign({}, headers || {}, { Range: "bytes=0-0" });
  if (typeof fetch !== "undefined") {
    return fetch(url, { headers: rangeHeaders }).then(function(response) {
      if (!response)
        return 0;
      var cr = response.headers && response.headers.get("content-range") || "";
      var match = cr.match(/\/(\d+)$/);
      if (match)
        return Number(match[1]);
      var cl = response.headers && response.headers.get("content-length") || "";
      return Number(cl) || 0;
    }).catch(function() {
      return 0;
    });
  }
  try {
    var axios = require("axios");
    return axios.head(url, { headers: rangeHeaders }).then(function(response) {
      if (!response || !response.headers)
        return 0;
      var cr = response.headers["content-range"] || "";
      var match = cr.match(/\/(\d+)$/);
      if (match)
        return Number(match[1]);
      var cl = response.headers["content-length"] || "";
      return Number(cl) || 0;
    }).catch(function() {
      return 0;
    });
  } catch (e) {
    return Promise.resolve(0);
  }
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
function mp4QualityLabel(height) {
  if (!height)
    return "unknown";
  return height < 480 ? "unknown" : height + "p";
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
        quality: mp4QualityLabel(src.quality),
        kind: "mp4",
        headers: { Referer: embedUrl, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      };
    });
  }).catch(function() {
    return [];
  });
}

// src/lib/mp4-probe.js
var CODEC_BOXES = { avc1: 1, avc3: 1, hvc1: 1, hev1: 1, hvc2: 1, shv1: 1, mp4v: 1 };
function readUint32BE(u8, offset) {
  return u8[offset] * 16777216 + (u8[offset + 1] << 16) + (u8[offset + 2] << 8) + u8[offset + 3] >>> 0;
}
function readUint16BE(u8, offset) {
  return (u8[offset] << 8) + u8[offset + 1] >>> 0;
}
function readUint8(u8, offset) {
  return u8[offset];
}
function readFourCC(u8, offset) {
  return String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
}
function qualityFromResolution(width, height) {
  if (!height || height <= 0)
    return "unknown";
  if (height >= 2160)
    return "4K";
  if (height >= 1440)
    return "1440p";
  if (height >= 1080)
    return "1080p";
  if (height >= 720)
    return "720p";
  if (height >= 480)
    return "480p";
  if (height >= 360)
    return "360p";
  if (height >= 240)
    return "240p";
  if (height >= 144)
    return "144p";
  return "unknown";
}
function probeMp4Resolution(url, headers, rangeBytes) {
  var chunkSize = rangeBytes || 65536;
  return fetchBinaryRange(url, headers, 0, 255).then(function(header) {
    if (!header || header.length < 16) {
      return fetchBinary(url, headers, chunkSize).then(function(u8) {
        if (!u8 || u8.length < 16)
          return null;
        return parseMp4Root(u8, u8.length);
      });
    }
    var faststart = detectFaststart(header);
    if (faststart) {
      return fetchBinary(url, headers, chunkSize).then(function(u8) {
        if (!u8 || u8.length < 16)
          return null;
        return parseMp4Root(u8, u8.length);
      });
    }
    return probeMp4FromEnd(url, headers, chunkSize);
  }).catch(function() {
    return null;
  });
}
function detectFaststart(header) {
  var offset = 0;
  var end = header.length;
  var sawFtyp = false;
  while (offset + 8 <= end) {
    var size = readUint32BE(header, offset);
    var type = readFourCC(header, offset + 4);
    if (size < 8)
      break;
    if (type === "ftyp") {
      sawFtyp = true;
    } else if (type === "moov") {
      return true;
    } else if (type === "mdat" || type === "free" || type === "skip" || type === "wide") {
      return false;
    }
    if (offset + size > end)
      break;
    offset += size;
  }
  return true;
}
function probeMp4FromEnd(url, headers, chunkSize) {
  return fetchFileSize(url, headers).then(function(totalSize) {
    if (totalSize <= 0)
      return null;
    var start = Math.max(0, totalSize - chunkSize);
    return fetchBinaryRange(url, headers, start, totalSize - 1).then(function(u8) {
      if (!u8 || u8.length < 16)
        return null;
      var moovOffset = findMoovBackwards(u8);
      if (moovOffset < 0)
        return null;
      var moovSize = readUint32BE(u8, moovOffset);
      var moovFileOffset = start + moovOffset;
      if (moovOffset + moovSize > u8.length) {
        var fetchSize = Math.min(moovSize, 262144);
        var fetchEnd = Math.min(moovFileOffset + fetchSize - 1, totalSize - 1);
        return fetchBinaryRange(url, headers, moovFileOffset, fetchEnd).then(function(moovData) {
          if (!moovData || moovData.length < 16)
            return null;
          return parseMoov(moovData, 8, moovData.length);
        });
      }
      return parseMoov(u8, moovOffset + 8, moovOffset + moovSize);
    });
  }).catch(function() {
    return null;
  });
}
function findMoovBackwards(u8) {
  for (var i = u8.length - 4; i >= 4; i--) {
    if (u8[i] === 109 && u8[i + 1] === 111 && u8[i + 2] === 111 && u8[i + 3] === 118) {
      var boxStart = i - 4;
      var size = readUint32BE(u8, boxStart);
      if (size >= 8 && size <= 104857600) {
        return boxStart;
      }
    }
  }
  return -1;
}
function parseMp4Root(u8, end) {
  var offset = 0;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8)
      break;
    var boxEnd = offset + size;
    if (boxEnd > end)
      boxEnd = end;
    if (type === "moov") {
      var result = parseMoov(u8, offset + 8, boxEnd);
      if (result)
        return result;
    }
    offset += size;
  }
  return null;
}
function parseMoov(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8)
      break;
    var boxEnd = offset + size;
    if (boxEnd > end)
      boxEnd = end;
    if (type === "trak") {
      var result = parseTrak(u8, offset + 8, boxEnd);
      if (result && result.width > 0 && result.height > 0)
        return result;
    }
    offset += size;
  }
  return null;
}
function parseTrak(u8, start, end) {
  var tkhdResult = null;
  var stsdResult = null;
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8)
      break;
    var boxEnd = offset + size;
    if (boxEnd > end)
      boxEnd = end;
    if (type === "tkhd") {
      tkhdResult = parseTkhd(u8, offset + 8, boxEnd);
    } else if (type === "mdia") {
      stsdResult = parseMdia(u8, offset + 8, boxEnd);
    }
    offset += size;
  }
  if (stsdResult && stsdResult.width > 0 && stsdResult.height > 0)
    return stsdResult;
  return tkhdResult;
}
function parseTkhd(u8, start, end) {
  if (start + 4 > end)
    return null;
  var version = readUint8(u8, start);
  var width, height;
  if (version === 1) {
    if (start + 104 > end)
      return null;
    width = readUint32BE(u8, start + 96);
    height = readUint32BE(u8, start + 100);
  } else {
    if (start + 84 > end)
      return null;
    width = readUint32BE(u8, start + 76);
    height = readUint32BE(u8, start + 80);
  }
  return { width: Math.round(width / 65536), height: Math.round(height / 65536), codec: "" };
}
function parseMdia(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8)
      break;
    var boxEnd = offset + size;
    if (boxEnd > end)
      boxEnd = end;
    if (type === "minf") {
      var r = parseMinf(u8, offset + 8, boxEnd);
      if (r)
        return r;
    }
    offset += size;
  }
  return null;
}
function parseMinf(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8)
      break;
    var boxEnd = offset + size;
    if (boxEnd > end)
      boxEnd = end;
    if (type === "stbl") {
      var r = parseStbl(u8, offset + 8, boxEnd);
      if (r)
        return r;
    }
    offset += size;
  }
  return null;
}
function parseStbl(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8)
      break;
    var boxEnd = offset + size;
    if (boxEnd > end)
      boxEnd = end;
    if (type === "stsd") {
      var r = parseStsd(u8, offset + 8, boxEnd);
      if (r)
        return r;
    }
    offset += size;
  }
  return null;
}
function parseStsd(u8, start, end) {
  if (start + 8 > end)
    return null;
  var offset = start + 8;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8)
      break;
    var boxEnd = offset + size;
    if (boxEnd > end)
      boxEnd = end;
    if (CODEC_BOXES[type]) {
      return parseVisualSampleEntry(u8, offset + 8, boxEnd, type);
    }
    var inner = findCodecBox(u8, offset + 8, boxEnd);
    if (inner)
      return inner;
    offset += size;
  }
  return null;
}
function findCodecBox(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8)
      break;
    var boxEnd = offset + size;
    if (boxEnd > end)
      boxEnd = end;
    if (CODEC_BOXES[type]) {
      return parseVisualSampleEntry(u8, offset + 8, boxEnd, type);
    }
    offset += size;
  }
  return null;
}
function parseVisualSampleEntry(u8, start, end, codec) {
  if (start + 28 > end)
    return null;
  var width = readUint16BE(u8, start + 24);
  var height = readUint16BE(u8, start + 26);
  return { width, height, codec };
}
function enhanceStreamQuality(streams, options) {
  if (!streams || streams.length === 0)
    return Promise.resolve(streams || []);
  var hlsProbeFn = options && options.hlsProbe || null;
  var promises = streams.map(function(stream) {
    if (!stream || !stream.url)
      return Promise.resolve(stream);
    var headers = stream.headers || {};
    var probePromise;
    if (stream.url.indexOf(".m3u8") >= 0) {
      if (hlsProbeFn) {
        probePromise = hlsProbeFn(stream.url, headers).catch(function() {
          return null;
        });
      } else {
        return Promise.resolve(stream);
      }
    } else if (stream.url.indexOf(".mp4") >= 0) {
      probePromise = probeMp4Resolution(stream.url, headers).catch(function() {
        return null;
      });
    } else {
      return Promise.resolve(stream);
    }
    return probePromise.then(function(result) {
      if (result && result.width > 0 && result.height > 0) {
        stream.quality = qualityFromResolution(result.width, result.height);
      }
      return stream;
    });
  });
  return Promise.all(promises);
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

// src/desiruleztv-net/index.js
var SITE_BASE = "https://desiruleztv.net";
var SEARCH_PATH = "/?s=";
var CATEGORY_PATH = "/category/";
var ARCHIVE_PAGE_PATH = "/page/";
var DESIRULEZ_HOST_RE = new RegExp(
  "^https://(?:www\\.)?desiruleztv\\.net/",
  "i"
);
var VKPRIME_RE = embedHostRegex(VKPRIME_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var VKSPEED_RE = embedHostRegex(VKSPEED_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
function displayBackend2(backend) {
  return String(backend || "source").replace(/(^|[-_\s]+)([a-z])/g, function(_match, prefix, ch) {
    return prefix + ch.toUpperCase();
  }).replace(/[-_]+/g, "");
}
function normalizeIframeUrl(src) {
  var url = String(src || "").trim();
  if (url.startsWith("//")) {
    return "https:" + url;
  }
  return url;
}
function findPlayerIframes(markup) {
  return dedupe(
    iframeSrcCandidates(markup).map(normalizeIframeUrl).filter(function(href) {
      return VKPRIME_RE.test(href) || VKSPEED_RE.test(href);
    })
  );
}
function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) {
    return [];
  }
  var dateQuery = dateSlug.replace(/-/g, " ");
  return (request.slugCandidates || []).map(function(slug) {
    return SITE_BASE + SEARCH_PATH + encodeURIComponent(slug + " " + dateQuery).replace(/%20/g, "+");
  });
}
function buildArchiveUrls(request) {
  var urls = [];
  var slugs = request.slugCandidates || [];
  for (var i = 0; i < slugs.length; i += 1) {
    urls.push(SITE_BASE + CATEGORY_PATH + slugs[i] + "/");
    urls.push(SITE_BASE + CATEGORY_PATH + slugs[i] + ARCHIVE_PAGE_PATH + "2/");
    urls.push(SITE_BASE + CATEGORY_PATH + slugs[i] + ARCHIVE_PAGE_PATH + "3/");
  }
  return dedupe(urls);
}
function episodePageCandidates(markup, request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) {
    return [];
  }
  return dedupe(
    links(markup).filter(function(href) {
      if (!DESIRULEZ_HOST_RE.test(href)) {
        return false;
      }
      if (href.includes("/category/")) {
        return false;
      }
      if (!href.toLowerCase().includes(dateSlug)) {
        return false;
      }
      return (request.slugCandidates || []).some(function(slug) {
        return href.toLowerCase().includes(slug);
      });
    })
  );
}
function resolveFromEpisodeUrls(fetchImpl, episodeUrls) {
  if (episodeUrls.length === 0) {
    return Promise.resolve([]);
  }
  return Promise.all(
    episodeUrls.map(function(url) {
      return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS }).catch(function(e) {
        console.log("[DesiRulezTV.net] episode page fetch failed for " + url + ": " + (e && e.message));
        return null;
      });
    })
  ).then(function(episodePages) {
    var allIframeUrls = dedupe(
      episodePages.flatMap(function(page) {
        return page ? findPlayerIframes(page) : [];
      })
    );
    if (allIframeUrls.length === 0) {
      return [];
    }
    return Promise.all(
      allIframeUrls.map(function(iframeUrl) {
        var backend = iframeUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
        return resolveVkPlayer(iframeUrl, SITE_BASE + "/", { fetchImpl }).then(function(sources) {
          var real = (sources || []).filter(function(s) {
            return !isPlaceholderUrl(s.url);
          });
          if (real.length === 0) {
            return null;
          }
          var best = real[0];
          return fetchContentLength(fetchImpl, best.url, best.headers).then(function(contentLength) {
            return {
              backend,
              kind: "mp4",
              quality: best.quality,
              url: best.url,
              size: formatBytes(contentLength),
              duration: 0,
              sourceTag: "",
              headers: best.headers
            };
          });
        }).catch(function(e) {
          console.log("[DesiRulezTV.net] player resolution failed for " + iframeUrl + ": " + (e && e.message));
          return null;
        });
      })
    ).then(function(resolved) {
      return dedupeStreams(resolved);
    });
  });
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
    return resolveFromEpisodeUrls(fetchImpl, episodeUrls).then(function(streams) {
      if (streams.length > 0) {
        return streams;
      }
      return processArchive(fetchImpl, archiveUrls, request, index + 1);
    });
  });
}
function resolveDesiRulezTV(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var searchUrls = buildSearchUrls(request);
  var archiveUrls = buildArchiveUrls(request);
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
        return resolveFromEpisodeUrls(fetchImpl, episodeUrls);
      }
      return processArchive(fetchImpl, archiveUrls, request, 0);
    });
  }
  return processArchive(fetchImpl, archiveUrls, request, 0);
}
function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveDesiRulezTV(request, { fetchImpl }).then(function(resolved) {
    return dedupeStreams(resolved).map(function(stream) {
      stream.name = "DesiRulezTV.net " + displayBackend2(stream.backend);
      if (stream.sourceTag) {
        stream.name += " (" + stream.sourceTag + ")";
      }
      return toNuvioStream(request, stream);
    });
  }).then(function(streams) {
    return enhanceStreamQuality(streams);
  }).catch(function(error) {
    console.log("[DesiRulezTV.net] resolver failed: " + error.message);
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
    console.log("[DesiRulezTV.net] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
