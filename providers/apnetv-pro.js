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

// src/lib/episodes.js
var MONTH_NUM = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  // Abbreviated forms (tellynagari-style slugs: "27th-sep-2026")
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11
};
var NON_EPISODE_RE = /promo|trailer|teaser|preview|spoiler|coming-soon|written-update|review/i;
function slugTimestamp(href) {
  var lower = String(href || "").toLowerCase();
  var m = lower.match(/(\d{1,2})(?:st|nd|rd|th)-([a-z]+)-(\d{4})/);
  if (m && MONTH_NUM[m[2]] !== void 0) {
    return Date.UTC(Number(m[3]), MONTH_NUM[m[2]], Number(m[1]));
  }
  m = lower.match(/([a-z]+)-(\d{1,2})(?:st|nd|rd|th)-(\d{4})/);
  if (m && MONTH_NUM[m[1]] !== void 0) {
    return Date.UTC(Number(m[3]), MONTH_NUM[m[1]], Number(m[2]));
  }
  return 0;
}
function postSlugVariants(request) {
  var candidates = request.slugCandidates || [];
  var extra = [];
  for (var i = 0; i < candidates.length; i++) {
    var stripped = candidates[i].replace(/-\d{4}$/, "");
    if (stripped !== candidates[i]) {
      extra.push(stripped);
    }
    extra.push(candidates[i].replace(/-s(?=-|$)/g, "s"));
  }
  return dedupe(candidates.concat(extra));
}
function hasYearSuffix(slugCandidates2) {
  return (slugCandidates2 || []).some(function(slug) {
    return /-\d{4}$/.test(slug);
  });
}
function showYear(slugCandidates2) {
  for (var i = 0; i < (slugCandidates2 || []).length; i++) {
    var m = slugCandidates2[i].match(/-(\d{4})$/);
    if (m)
      return m[1];
  }
  return "";
}
function episodePostCandidates(hrefs, request, hostRe, rejectRe, slugVariants) {
  slugVariants = slugVariants || postSlugVariants(request);
  var dateSlug = episodeDateSlug(request.airDate);
  var ep = Number(request.episode || 0);
  var links2 = dedupe(
    (hrefs || []).map(function(href) {
      return String(href || "").split("#")[0];
    }).filter(function(href) {
      if (!hostRe.test(href))
        return false;
      if (rejectRe && rejectRe.test(href))
        return false;
      if (NON_EPISODE_RE.test(href))
        return false;
      var lower = href.toLowerCase();
      return slugVariants.some(function(slug) {
        return lower.indexOf(slug) !== -1;
      });
    })
  );
  var year = showYear(request.slugCandidates);
  if (year && hasYearSuffix(request.slugCandidates)) {
    var fullSlug = (request.slugCandidates || []).filter(function(s) {
      return s.indexOf("-" + year) !== -1;
    });
    var strict = links2.filter(function(href) {
      var lower = href.toLowerCase();
      return fullSlug.some(function(slug) {
        return lower.indexOf(slug) !== -1;
      });
    });
    if (strict.length === 0) {
      strict = links2.filter(function(href) {
        var lower = href.toLowerCase();
        if (lower.indexOf(year) !== -1)
          return true;
        var ts = slugTimestamp(href);
        return ts > 0 && new Date(ts).getUTCFullYear() === Number(year);
      });
    }
    links2 = strict;
  }
  if (dateSlug) {
    var dateVariants = [dateSlug];
    var dm = dateSlug.match(/^(\d+\w{2})-([a-z]+)-(\d{4})$/);
    if (dm)
      dateVariants.push(dm[1] + "-" + dm[2].slice(0, 3) + "-" + dm[3]);
    var dated = links2.filter(function(href) {
      var lower = href.toLowerCase();
      return dateVariants.some(function(v) {
        return lower.indexOf(v) !== -1;
      });
    });
    if (dated.length > 0)
      return dated;
  }
  if (ep > 0) {
    var epRe = new RegExp("episode-" + ep + "(?:[/-]|$)");
    var numbered = links2.filter(function(href) {
      return epRe.test(href.toLowerCase());
    });
    if (numbered.length > 0)
      return numbered;
  }
  if (ep > 0) {
    var byTs = {};
    links2.forEach(function(href) {
      var ts = slugTimestamp(href);
      if (ts > 0) {
        if (!byTs[ts])
          byTs[ts] = [];
        byTs[ts].push(href);
      }
    });
    var dates = Object.keys(byTs).map(Number).sort(function(a, b) {
      return a - b;
    });
    var target = dates[ep - 1];
    if (target) {
      if (request.airDate) {
        var airTs = Date.parse(request.airDate + "T00:00:00Z");
        if (isNaN(airTs) || Math.abs(target - airTs) > 2 * 24 * 60 * 60 * 1e3) {
          return [];
        }
      }
      return byTs[target];
    }
  }
  return [];
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
function sortStreamsBest(streams, runtimeMinutes) {
  var minutes = Number(runtimeMinutes) || 0;
  var res = function(stream) {
    var m = /(\d{3,4})\s*p/i.exec(String(stream.quality || ""));
    return m ? Number(m[1]) : 0;
  };
  var score = function(stream) {
    var bw = stream.bandwidth || 0;
    if (!bw) {
      var size = Number(stream.sizeBytes) || 0;
      bw = size > 0 && minutes > 0 ? size * 8 / (minutes * 60) : size;
    }
    var r = res(stream);
    return bw * (r > 0 ? Math.min(r, 2160) / 720 : 1);
  };
  return streams.slice().sort(function(a, b) {
    return score(b) - score(a);
  });
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

// src/lib/dramavideo.js
var PLAYER_HOST = "https://player.dramavideo.se";
var PLAYER_ORIGIN = PLAYER_HOST;
function dramavideoParamsFromMarkup(markup) {
  var text = String(markup || "");
  var out = [];
  var tagRe = /<(?:div|li|a|span|button)[^>]*data-(?:embed|video)="[^"]+"[^>]*>/gi;
  var m;
  while ((m = tagRe.exec(text)) !== null) {
    var tag = m[0];
    var idM = tag.match(/data-(?:embed|video)="([^"]+)"/i);
    var svM = tag.match(/data-(?:sv-id|svid|provider)="([^"]+)"/i);
    if (idM) {
      out.push({ id: idM[1], sv: svM ? svM[1] : "v3" });
    }
  }
  return out;
}
function hexToBytes(hex) {
  var str = String(hex || "");
  var bytes = new Uint8Array(str.length / 2);
  for (var i = 0; i < str.length; i += 2) {
    bytes[i / 2] = parseInt(str.substr(i, 2), 16);
  }
  return bytes;
}
function extractCipher(markup) {
  var text = String(markup || "");
  var enc = text.match(/encData\s*=\s*"([^"]+)"/);
  var key = text.match(/keyHex\s*=\s*"([0-9a-fA-F]+)"/);
  var iv = text.match(/ivHex\s*=\s*"([0-9a-fA-F]+)"/);
  if (!enc || !key || !iv)
    return null;
  return { encData: enc[1], keyHex: key[1], ivHex: iv[1] };
}
function extractSources(decryptedHtml) {
  var text = String(decryptedHtml || "");
  var streams = [];
  var m = text.match(/JSON\.parse\(`(\[[^`]*"file"[^`]*\])`\)/);
  if (m) {
    try {
      var parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) {
        parsed.forEach(function(s) {
          if (s && s.file) {
            streams.push({ url: s.file, kind: s.type === "mp4" ? "mp4" : "hls", label: s.label || "" });
          }
        });
      }
    } catch (e) {
    }
  }
  if (streams.length === 0) {
    var urls = text.match(/https:\/\/hls\.dramavideo\.se\/media\/[0-9a-f]+/gi) || [];
    urls.forEach(function(u) {
      streams.push({ url: u, kind: "hls", label: "" });
    });
  }
  return streams;
}
function aesCbcDecrypt(encData, keyHex, ivHex) {
  var keyBytes = hexToBytes(keyHex);
  var ivBytes = hexToBytes(ivHex);
  var cipherBytes = Uint8Array.from(
    atobBinary(encData).split("").map(function(c) {
      return c.charCodeAt(0);
    })
  );
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.decrypt) {
    return crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]).then(function(key) {
      return crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, cipherBytes);
    }).then(function(plain) {
      return u8ToString(new Uint8Array(plain));
    });
  }
  try {
    var CryptoJS = require("crypto-js");
    var keyWA = CryptoJS.enc.Hex.parse(keyHex);
    var ivWA = CryptoJS.enc.Hex.parse(ivHex);
    var params = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(encData)
    });
    var out = CryptoJS.AES.decrypt(params, keyWA, {
      iv: ivWA,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });
    return Promise.resolve(out.toString(CryptoJS.enc.Utf8));
  } catch (e) {
    return Promise.reject(new Error("No AES implementation available"));
  }
}
function atobBinary(s) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(s || "").replace(/[^A-Za-z0-9+/=]/g, "");
  var out = "";
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < clean.length; i++) {
    var c = clean.charAt(i);
    if (c === "=")
      break;
    buffer = buffer << 6 | chars.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode(buffer >> bits & 255);
    }
  }
  return out;
}
function u8ToString(u8) {
  var out = "";
  var i = 0;
  while (i < u8.length) {
    var b = u8[i];
    if (b < 128) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 224) {
      out += String.fromCharCode((b & 31) << 6 | u8[i + 1] & 63);
      i += 2;
    } else if (b < 240) {
      out += String.fromCharCode(
        (b & 15) << 12 | (u8[i + 1] & 63) << 6 | u8[i + 2] & 63
      );
      i += 3;
    } else {
      var cp = (b & 7) << 18 | (u8[i + 1] & 63) << 12 | (u8[i + 2] & 63) << 6 | u8[i + 3] & 63;
      cp -= 65536;
      out += String.fromCharCode(55296 + (cp >> 10), 56320 + (cp & 1023));
      i += 4;
    }
  }
  return out;
}
function resolveDramavideoEmbed(fetchImpl, id, sv, referer) {
  var playerUrl = PLAYER_HOST + "/in?id=" + encodeURIComponent(id) + "&sv=" + encodeURIComponent(sv || "v3");
  var headers = { "User-Agent": UA, Referer: referer || "https://dramavideo.se/" };
  return fetchText(fetchImpl, playerUrl, { headers }).then(function(page) {
    if (!page)
      return [];
    var cipher = extractCipher(page);
    if (!cipher)
      return [];
    return aesCbcDecrypt(cipher.encData, cipher.keyHex, cipher.ivHex).then(function(decrypted) {
      return extractSources(decrypted).map(function(s) {
        s.backend = "dramavideo";
        s.quality = s.label || "";
        s.headers = {
          "User-Agent": UA,
          Referer: PLAYER_HOST + "/",
          Origin: PLAYER_ORIGIN
        };
        return s;
      });
    });
  }).catch(function(e) {
    console.log("[DramaVideo] resolve failed: " + (e && e.message));
    return [];
  });
}

// src/apnetv-pro/index.js
var SITE_BASE = "https://apnetv.pro";
var SEARCH_PATH = "/?s=";
var SITE_HOST_RE = /^https:\/\/(?:www\.)?apnetv\.pro\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed)\b|\/(about-us|contact-us|dmca|privacy-policy)\//i;
function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  var slugs = (request.slugCandidates || []).slice(0, 2);
  var urls = [];
  for (var i = 0; i < slugs.length; i++) {
    if (dateSlug) {
      urls.push(
        SITE_BASE + SEARCH_PATH + encodeURIComponent(slugs[i] + " " + dateSlug.replace(/-/g, " ")).replace(/%20/g, "+")
      );
    }
    urls.push(
      SITE_BASE + SEARCH_PATH + encodeURIComponent(slugs[i].replace(/-/g, " ")).replace(/%20/g, "+")
    );
  }
  return dedupe(urls);
}
function episodePageCandidates(markup, request) {
  return episodePostCandidates(links(markup), request, SITE_HOST_RE, NON_POST_RE);
}
function resolveEpisodeUrl(fetchImpl, postUrl) {
  return fetchText(fetchImpl, postUrl, { headers: BROWSER_HEADERS }).then(function(post) {
    if (!post)
      return [];
    var params = dramavideoParamsFromMarkup(post);
    if (params.length === 0)
      return [];
    return Promise.all(
      params.slice(0, 3).map(function(p) {
        return resolveDramavideoEmbed(fetchImpl, p.id, p.sv, postUrl);
      })
    ).then(function(sets) {
      var streams = [];
      sets.forEach(function(set) {
        (set || []).forEach(function(s) {
          if (s)
            streams.push(s);
        });
      });
      return streams;
    });
  }).catch(function(e) {
    console.log("[ApneTV] resolve failed for " + postUrl + ": " + (e && e.message));
    return [];
  });
}
function resolveApneTV(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var searchUrls = buildSearchUrls(request);
  if (searchUrls.length === 0) {
    return Promise.resolve([]);
  }
  return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function(page) {
    var episodeUrls = episodePageCandidates(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function(episodeUrls) {
    if (!episodeUrls)
      return [];
    return Promise.all(
      episodeUrls.map(function(url) {
        return resolveEpisodeUrl(fetchImpl, url);
      })
    ).then(function(sets) {
      var all = [];
      sets.forEach(function(set) {
        (set || []).forEach(function(s) {
          if (s)
            all.push(s);
        });
      });
      return dedupeStreams(all);
    });
  });
}
function getStreamsForRequest(request, options) {
  return resolveApneTV(request, options).then(function(resolved) {
    return sortStreamsBest(dedupeStreams(resolved), request.runtimeMinutes).map(function(stream, idx) {
      stream.name = (idx < 9 ? "0" : "") + (idx + 1) + " ApneTV " + stream.backend;
      return toNuvioStream(request, stream);
    });
  }).catch(function(error) {
    console.log("[ApneTV] resolver failed: " + error.message);
    return [];
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv")
    return Promise.resolve([]);
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY }).then(function(request) {
    return getStreamsForRequest(request, { fetchImpl: typeof fetch !== "undefined" ? fetch : null });
  }).catch(function(error) {
    console.log("[ApneTV] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
