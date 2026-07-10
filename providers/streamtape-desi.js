// src/lib/constants.js
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var BROWSER_HEADERS = { "User-Agent": UA };
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

// src/streamtape-desi/index.js
var STREAMTAPE_DOMAINS = [
  "streamtape.com",
  "streamtape.to",
  "streamtape.xyz",
  "streamtape.cc",
  "stape.fun",
  "strcloud.club",
  "strcloud.link",
  "streamadblocker.com"
];
var STREAMTAPE_DOMAIN_RE = new RegExp(
  "(" + STREAMTAPE_DOMAINS.map(function(d) {
    return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|") + ")",
  "i"
);
var STREAMTAPE_URL_RE = new RegExp(
  "https?://(?:www\\.)?(?:" + STREAMTAPE_DOMAINS.map(function(d) {
    return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|") + ")/(?:e|v|d)/([A-Za-z0-9]+)",
  "gi"
);
var WATCH_MOVIES_BASE = "https://www.watch-movies.com.pk/";
var ULLUHD_BASE = "https://ulluhd.com/";
var STREAMTAPE_EMBED_BASE = "https://streamtape.to/v/";
var EPISODE_SUFFIXES = [
  "-hindi-season-{season}-watch-online-hd-print-free-download/",
  "-hindi-dubbed-season-{season}-watch-online-hd-print-free-download/",
  "-hindi-reality-show-watch-online-hd-print-free-download/"
];
var MOVIE_SUFFIXES = [
  "-hindi-full-movie-watch-online-hd-print-free-download/",
  "-hindi-dubbed-full-movie-watch-online-hd-print-free-download/"
];
var EPISODE_LABELS = ["ep", "episode"];
function isStreamTapeUrl(url) {
  return STREAMTAPE_DOMAIN_RE.test(String(url || ""));
}
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
function qualityNearStreamTape(raw) {
  var text = decodeText(raw);
  var patterns = [
    /(\d{3,4})p\s*(?:Quality\s*Links\s*)?Streamtape/gi,
    /Streamtape\s*(\d{3,4})p/gi,
    /Quality[^<]*?(\d{3,4})p[^<]*?Streamtape/gi
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
function parseGetVideoUrl(html) {
  var regex = /getElementById\('([^']+)'\)\.innerHTML\s*=\s*["']([^"']*)["']\s*(?:\+\s*['"]['"]?\s*)?\+\s*\(['"]([^'"]+)['"]\)\.substring\((\d+)\)(?:\.substring\((\d+)\))?/g;
  var match;
  var bestUrl = "";
  while ((match = regex.exec(html)) !== null) {
    var elemId = match[1];
    var prefix = match[2];
    var junk = match[3];
    var sub1 = Number(match[4]) || 0;
    var sub2 = Number(match[5] || 0);
    var suffix = junk;
    if (sub1 > 0) {
      suffix = suffix.substring(sub1);
    }
    if (sub2 > 0) {
      suffix = suffix.substring(sub2);
    }
    var fullUrl = prefix + suffix;
    if (fullUrl.indexOf("get_video") !== -1) {
      if (fullUrl.indexOf("//") === 0) {
        fullUrl = "https:" + fullUrl;
      }
      if (elemId.indexOf("robotlink") !== -1 || elemId.indexOf("captchalink") !== -1) {
        return fullUrl;
      }
      if (!bestUrl) {
        bestUrl = fullUrl;
      }
    }
  }
  return bestUrl;
}
function extractStreamTapeId(url) {
  var match = String(url || "").match(/\/(?:e|v|d)\/([A-Za-z0-9]+)/);
  return match ? match[1] : "";
}
function resolveStreamTape(embedUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var videoId = extractStreamTapeId(embedUrl);
  if (!videoId) {
    return Promise.resolve(null);
  }
  var domains = STREAMTAPE_DOMAINS;
  var pageUrl = "";
  var html = null;
  function tryDomain(index) {
    if (index >= domains.length) {
      return Promise.resolve(null);
    }
    pageUrl = "https://" + domains[index] + "/v/" + videoId;
    return fetchImpl(pageUrl, browserHeaders("")).then(function(response) {
      if (!response) {
        return tryDomain(index + 1);
      }
      return response.text().then(function(text) {
        if (text && (text.indexOf("norobotlink") !== -1 || text.indexOf("robotlink") !== -1 || text.indexOf("get_video") !== -1)) {
          html = text;
          return text;
        }
        return tryDomain(index + 1);
      });
    }).catch(function() {
      return tryDomain(index + 1);
    });
  }
  return tryDomain(0).then(function() {
    if (!html) {
      console.log("[StreamTape] no embed page with robotlink found for video ID " + videoId);
      return null;
    }
    var getVideoUrl = parseGetVideoUrl(html);
    if (!getVideoUrl) {
      console.log("[StreamTape] could not parse get_video URL from robotlink JS for " + pageUrl);
      return null;
    }
    if (getVideoUrl.indexOf("stream=1") === -1) {
      getVideoUrl += (getVideoUrl.indexOf("?") !== -1 ? "&" : "?") + "stream=1";
    }
    return fetchImpl(getVideoUrl, {
      redirect: "manual",
      headers: Object.assign({}, BROWSER_HEADERS, { Referer: pageUrl })
    }).then(function(response) {
      if (!response) {
        console.log("[StreamTape] get_video fetch returned no response for " + getVideoUrl);
        return null;
      }
      var location = "";
      if (response.headers && typeof response.headers.get === "function") {
        location = response.headers.get("location") || "";
      }
      if (!location && response.url && response.url.indexOf("tapecontent.net") !== -1) {
        location = response.url;
      }
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
        videoId
      };
    }).catch(function(err) {
      console.log("[StreamTape] get_video fetch error for " + getVideoUrl + ": " + (err && err.message || err));
      return null;
    });
  }).catch(function(err) {
    console.log("[StreamTape] resolveStreamTape error for video ID " + videoId + ": " + (err && err.message || err));
    return null;
  });
}
function buildWatchMoviesEpisodeUrls(request) {
  var slugs = request.slugCandidates || [];
  var season = request.season;
  var episode = request.episode;
  var urls = [];
  var epVariants = [
    String(episode),
    String(episode).padStart(2, "0"),
    String(episode).padStart(3, "0")
  ];
  epVariants = dedupe(epVariants);
  var years = [];
  if (request.airYear) {
    years.push(request.airYear);
  }
  var currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  if (years.indexOf(String(currentYear)) === -1) {
    years.push(String(currentYear));
  }
  if (request.airYear) {
    var airYearNum = Number(request.airYear);
    if (years.indexOf(String(airYearNum - 1)) === -1) {
      years.push(String(airYearNum - 1));
    }
    if (years.indexOf(String(airYearNum + 1)) === -1) {
      years.push(String(airYearNum + 1));
    }
  }
  var expandedSuffixes = EPISODE_SUFFIXES.map(function(s2) {
    return s2.replace(/\{season\}/g, String(season));
  });
  for (var s = 0; s < slugs.length; s += 1) {
    for (var y = 0; y < years.length; y += 1) {
      for (var ev = 0; ev < epVariants.length; ev += 1) {
        for (var li = 0; li < EPISODE_LABELS.length; li += 1) {
          for (var xi = 0; xi < expandedSuffixes.length; xi += 1) {
            urls.push(
              WATCH_MOVIES_BASE + slugs[s] + "-" + years[y] + "-" + EPISODE_LABELS[li] + "-" + epVariants[ev] + expandedSuffixes[xi]
            );
          }
        }
      }
    }
  }
  return dedupe(urls);
}
function buildWatchMoviesMovieUrls(request) {
  var slugs = request.slugCandidates || [];
  var urls = [];
  var years = [];
  if (request.airYear) {
    years.push(request.airYear);
  }
  var currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  if (years.indexOf(String(currentYear)) === -1) {
    years.push(String(currentYear));
  }
  if (request.airYear) {
    var airYearNum = Number(request.airYear);
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
    for (var xi2 = 0; xi2 < MOVIE_SUFFIXES.length; xi2 += 1) {
      urls.push(WATCH_MOVIES_BASE + slugs[s] + MOVIE_SUFFIXES[xi2]);
    }
  }
  return dedupe(urls);
}
function watchMoviesHasStreamTape(markup) {
  return extractStreamTapeIds(markup).length > 0 || links(markup).some(function(href) {
    return isStreamTapeUrl(href);
  });
}
var ULLUHD_HOST_RE = /^https:\/\/ulluhd\.com\//i;
function buildUlluhdSearchUrls(request) {
  var title = request.title || "";
  var slugs = slugCandidates(title);
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
    allLinks.filter(function(href) {
      if (!ULLUHD_HOST_RE.test(href)) {
        return false;
      }
      var lower = href.toLowerCase();
      var titleMatch = titleSlugs.some(function(slug) {
        return lower.indexOf(slug) !== -1;
      });
      if (!titleMatch) {
        return false;
      }
      var seasonStr = String(season);
      var episodeStr = String(episode);
      var seasonPadded = String(season).padStart(2, "0");
      var episodePadded = String(episode).padStart(2, "0");
      var seasonMatch = lower.indexOf("s" + seasonStr) !== -1 || lower.indexOf("s" + seasonPadded) !== -1 || lower.indexOf("season-" + seasonStr) !== -1;
      var episodeMatch = lower.indexOf("e" + episodeStr) !== -1 || lower.indexOf("e" + episodePadded) !== -1 || lower.indexOf("ep" + episodePadded) !== -1 || lower.indexOf("ep-" + episodeStr) !== -1 || lower.indexOf("e" + episodePadded) !== -1;
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
    })
  );
}
function searchSite(fetchImpl, searchUrls, episodeCandidateFn, request) {
  if (searchUrls.length === 0) {
    return Promise.resolve([]);
  }
  return Promise.all(
    searchUrls.map(function(url) {
      return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS });
    })
  ).then(function(searchPages) {
    var episodeUrls = dedupe(
      searchPages.flatMap(function(page) {
        return page ? episodeCandidateFn(page, request) : [];
      })
    );
    return episodeUrls;
  });
}
function resolveStreamTapeFromPages(fetchImpl, pages) {
  var allEntries = [];
  for (var i = 0; i < pages.length; i += 1) {
    var page = pages[i].html;
    var ids = extractStreamTapeIds(page);
    var quality = qualityNearStreamTape(page);
    for (var j = 0; j < ids.length; j += 1) {
      allEntries.push({ id: ids[j], quality });
    }
    var pageLinks = links(page);
    for (var m = 0; m < pageLinks.length; m += 1) {
      var linkUrl = pageLinks[m];
      if (isStreamTapeUrl(linkUrl)) {
        var id = extractStreamTapeId(linkUrl);
        if (id) {
          allEntries.push({ id, quality: qualityNearStreamTape(page) });
        }
      }
    }
  }
  var seenIds = /* @__PURE__ */ new Set();
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
  return Promise.all(
    uniqueEntries.map(function(entry) {
      var embedUrl = STREAMTAPE_EMBED_BASE + entry.id;
      return resolveStreamTape(embedUrl, { fetchImpl }).then(function(resolved) {
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
            "User-Agent": UA
          }
        };
      }).catch(function() {
        return null;
      });
    })
  ).then(function(resolved) {
    return dedupeStreams(resolved.filter(function(s) {
      return s !== null;
    }));
  });
}
function resolveStreamTapeDesi(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  if (request.mediaType === "movie") {
    var movieUrls = buildWatchMoviesMovieUrls(request);
    var moviePromise = Promise.all(
      movieUrls.map(function(url) {
        return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS }).then(function(html) {
          if (!html) {
            return null;
          }
          if (watchMoviesHasStreamTape(html)) {
            return { url, html };
          }
          return null;
        }).catch(function() {
          return null;
        });
      })
    ).then(function(results) {
      return results.filter(function(r) {
        return r !== null;
      });
    });
    return moviePromise.then(function(pages) {
      if (pages.length === 0) {
        return [];
      }
      return resolveStreamTapeFromPages(fetchImpl, pages);
    });
  }
  var watchMoviesUrls = buildWatchMoviesEpisodeUrls(request);
  var ulluhdUrls = buildUlluhdSearchUrls(request);
  var watchMoviesPromise = Promise.all(
    watchMoviesUrls.map(function(url) {
      return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS }).then(function(html) {
        if (!html) {
          return null;
        }
        if (watchMoviesHasStreamTape(html)) {
          return { url, html };
        }
        return null;
      }).catch(function() {
        return null;
      });
    })
  ).then(function(results) {
    return results.filter(function(r) {
      return r !== null;
    });
  });
  var ulluhdPromise = searchSite(fetchImpl, ulluhdUrls, ulluhdEpisodeCandidates, request).then(function(episodeUrls) {
    return Promise.all(
      episodeUrls.map(function(url) {
        return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS }).then(function(html) {
          if (!html) {
            return null;
          }
          if (extractStreamTapeIds(html).length > 0 || links(html).some(function(href) {
            return isStreamTapeUrl(href);
          })) {
            return { url, html };
          }
          return null;
        }).catch(function() {
          return null;
        });
      })
    ).then(function(results) {
      return results.filter(function(r) {
        return r !== null;
      });
    });
  });
  return Promise.all([watchMoviesPromise, ulluhdPromise]).then(function(results) {
    var watchMoviesPages = results[0];
    var ulluhdPages = results[1];
    var allPages = watchMoviesPages.concat(ulluhdPages);
    if (allPages.length === 0) {
      return [];
    }
    var allEntries = [];
    for (var i = 0; i < allPages.length; i += 1) {
      var page = allPages[i].html;
      var ids = extractStreamTapeIds(page);
      var quality = qualityNearStreamTape(page);
      for (var j = 0; j < ids.length; j += 1) {
        allEntries.push({ id: ids[j], quality });
      }
      var pageLinks = links(page);
      for (var m = 0; m < pageLinks.length; m += 1) {
        var linkUrl = pageLinks[m];
        if (isStreamTapeUrl(linkUrl)) {
          var id = extractStreamTapeId(linkUrl);
          if (id) {
            allEntries.push({ id, quality: qualityNearStreamTape(page) });
          }
        }
      }
    }
    var seenIds = /* @__PURE__ */ new Set();
    var uniqueEntries = [];
    for (var n = 0; n < allEntries.length; n += 1) {
      if (!seenIds.has(allEntries[n].id)) {
        seenIds.add(allEntries[n].id);
        uniqueEntries.push(allEntries[n]);
      }
    }
    if (uniqueEntries.length === 0) {
      return [];
    }
    return Promise.all(
      uniqueEntries.map(function(entry) {
        var embedUrl = STREAMTAPE_EMBED_BASE + entry.id;
        return resolveStreamTape(embedUrl, { fetchImpl }).then(function(resolved) {
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
              "User-Agent": UA
            }
          };
        }).catch(function() {
          return null;
        });
      })
    ).then(function(resolved) {
      return dedupeStreams(resolved.filter(function(s) {
        return s !== null;
      }));
    });
  });
}
function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveStreamTapeDesi(request, { fetchImpl }).then(function(resolved) {
    return dedupeStreams(resolved).map(function(stream) {
      stream.name = "StreamTape Desi";
      return toNuvioStream(request, stream);
    });
  }).then(function(streams) {
    return enhanceStreamQuality(streams);
  }).catch(function(error) {
    console.log("[StreamTape Desi] resolver failed: " + error.message);
    return [];
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv" && mediaType !== "movie") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY }).then(function(request) {
    return getStreamsForRequest(request, { fetchImpl: typeof fetch !== "undefined" ? fetch : null });
  }).catch(function(error) {
    console.log("[StreamTape Desi] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
