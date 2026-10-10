var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/tellynagari-com/index.js
var tellynagari_com_exports = {};
__export(tellynagari_com_exports, {
  getStreams: () => getStreams
});
module.exports = __toCommonJS(tellynagari_com_exports);

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
function cachingFetch(fetchImpl) {
  var cache = {};
  return function(url, options) {
    options = options || {};
    var h = options.headers || {};
    var key = (options.method || "GET") + "|" + url + "|" + (h["User-Agent"] || "") + "|" + (h.Referer || h.referer || "") + "|" + (typeof options.body === "string" ? options.body : "");
    if (!cache[key]) {
      cache[key] = fetchImpl(url, options).then(function(res) {
        if (!res || res.ok === false) {
          return { ok: false, status: res ? res.status : 0 };
        }
        var hdrs = {};
        if (res.headers && typeof res.headers.get === "function") {
          ["content-range", "content-length", "content-type"].forEach(function(n) {
            hdrs[n] = res.headers.get(n);
          });
        }
        return res.text().then(function(body) {
          return { ok: true, status: res.status, statusText: res.statusText, url: res.url || url, body, headers: hdrs };
        });
      }).catch(function() {
        return { ok: false, status: 0 };
      });
    }
    return cache[key].then(function(cached) {
      if (!cached || !cached.ok) {
        return {
          ok: false,
          status: cached ? cached.status : 0,
          text: function() {
            return Promise.resolve("");
          },
          json: function() {
            return Promise.resolve(null);
          },
          headers: { get: function() {
            return null;
          } }
        };
      }
      return {
        ok: true,
        status: cached.status,
        statusText: cached.statusText,
        url: cached.url,
        headers: {
          get: function(name) {
            return cached.headers[String(name).toLowerCase()] || null;
          }
        },
        text: function() {
          return Promise.resolve(cached.body);
        },
        json: function() {
          try {
            return Promise.resolve(JSON.parse(cached.body));
          } catch (e) {
            return Promise.resolve(null);
          }
        }
      };
    });
  };
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

// src/lib/flow.js
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
      if (bandwidth > 1e8) {
        bandwidth = Math.round(bandwidth / 1e3);
        if (bandwidth > 1e8)
          bandwidth = 0;
      }
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
  if (variant.startsWith("player")) {
    return "player";
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
      var stream = buildFlowStream(quality, "", 0, playerUrl, streamHeaders, masterUrl);
      stream.bandwidth = variants.length > 0 ? variants[0].bandwidth : 0;
      return stream;
    });
  });
}

// src/lib/upbolt.js
var CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
var UPBOLT_RELAY = "https://lanes-knowing-alt-karma.trycloudflare.com/p?u=";
var UPBOLT_RE = /upbolt\.to\/(?:emb-|e\/)[A-Za-z0-9_-]+/i;
function resolveUpbolt(embedUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  if (embedUrl.indexOf("http") !== 0) {
    embedUrl = "https://" + embedUrl.replace(/^\/\//, "");
  }
  var idMatch = embedUrl.match(/\/(?:emb-|e\/)([A-Za-z0-9_-]+)/i);
  var crawler = { headers: { "User-Agent": CRAWLER_UA, Accept: "*/*" } };
  var page;
  if (idMatch && /\/e\//i.test(embedUrl)) {
    page = fetchText(fetchImpl, "https://upbolt.to/dl", {
      method: "POST",
      headers: {
        "User-Agent": CRAWLER_UA,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "op=embed&file_code=" + idMatch[1] + "&auto=1"
    });
  } else {
    page = fetchText(fetchImpl, embedUrl, crawler);
  }
  return page.then(function(html) {
    if (!html)
      return null;
    var m = html.match(/sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+\.m3u8[^"']*)/i) || html.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i);
    if (!m)
      return null;
    var masterUrl = m[1].replace(/\\\//g, "/");
    var relayUrl = UPBOLT_RELAY + encodeURIComponent(masterUrl);
    var tag = "";
    var tm = html.match(/<title>([^<]+)<\/title>/i);
    if (tm)
      tag = tm[1].trim();
    return fetchText(fetchImpl, relayUrl, crawler).then(function(manifest) {
      var stream = {
        backend: "upbolt",
        kind: "hls",
        quality: "",
        url: relayUrl,
        size: "",
        sizeBytes: 0,
        sourceTag: tag,
        // App fetches the relay, which ignores client headers; crawler UA kept
        // so any direct edge touch (cached master HITs) still looks crawler-ish.
        headers: { "User-Agent": CRAWLER_UA }
      };
      if (manifest) {
        var variants = parseHlsMasterPlaylist(manifest, masterUrl);
        if (variants.length > 0) {
          if (variants[0].height > 0)
            stream.quality = variants[0].height + "p";
          stream.bandwidth = variants[0].bandwidth;
        }
      }
      return stream;
    });
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
  var labelBitrate = function(stream) {
    var m = /(\d+(?:\.\d+)?)\s*Mbps/i.exec(String(stream.quality || ""));
    return m ? Number(m[1]) * 1e6 : 0;
  };
  var score = function(stream) {
    var bw = stream.bandwidth || labelBitrate(stream);
    if (!bw) {
      var size = Number(stream.sizeBytes) || 0;
      bw = size > 0 ? size * 8 / ((minutes > 0 ? minutes : 60) * 60) : 0;
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

// src/lib/chain.js
var VK_EMBED_RE = /(vkspeed|vkprime)\.com\/embed-[A-Za-z0-9_-]+(?:-\d+x\d+)?\.html/i;
var FLOW_RE = /flow\.tvlogy\.to\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?/i;
var MEDIA_META_RE = /\/media_meta\.php\?v=/i;
var M3U8_RE = /\.m3u8(?:\?|$)/i;
var MP4_RE = /\.mp4(?:\?|$)/i;
var HOP_PATH_RE = /\.php\?[^"'\s]*(?:id|v|url|docid|slug|source|src|file|embed|video|watch|play|go)=/i;
var JUNK_RE = /(?:facebook|twitter|instagram|t\.me|telegram|whatsapp|pinterest|youtube|google|gstatic|doubleclick|googlesyndication|popads|histats|feedburner|gravatar|disqus|w3\.org|schema\.org|gmpg\.org|creativecommons)\.|wp-(?:content|includes|json)|xmlrpc|\/feed\/|sitemap|\.css|\.js(?:on)?(?:\?|$)|\.(?:png|jpe?g|gif|svg|ico|woff2?|webp)(?:\?|$)|wp-login|#respond|\/comments?\//i;
function stripTags(raw) {
  return String(raw || "").replace(/<[^>]*>/g, "").trim();
}
function harvestPage(markup, pageUrl) {
  var found = [];
  var push = function(url, label2) {
    if (!url)
      return;
    url = decodeText(String(url).trim());
    if (url.indexOf("//") === 0)
      url = "https:" + url;
    if (url.charAt(0) === "/" || url.indexOf("http") !== 0) {
      url = resolveRelativeUrl(pageUrl, url);
    }
    if (url.indexOf("http") === 0)
      found.push({ url, label: label2 || "" });
  };
  var aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = aRe.exec(markup)) !== null) {
    var inner = stripTags(m[2]);
    var pm = inner.match(/\(([^()]{1,40})\)/);
    var label = pm ? pm[1] : inner.slice(0, 60);
    var urls = m[1].match(/https?:\/\/[^"'\s)]+|\/\/[^"'\s)]+/g) || [];
    urls.forEach(function(u) {
      push(u.replace(/[,;]+$/, ""), label);
    });
  }
  var attrRe = /(?:src|href|file|source|data-[A-Za-z_-]+|streamUrl)\s*=\s*["']([^"'<>\s]+)["']/gi;
  while ((m = attrRe.exec(markup)) !== null) {
    push(m[1], "");
  }
  var bareRe = /(https?:\/\/[^"'\s<>)\]]+(?:vkspeed\.com|vkprime\.com|flow\.tvlogy\.to|streaming\.disk\.yandex\.net|media_meta\.php|\.m3u8|\.mp4)[^"'\s<>)\]]*)/gi;
  while ((m = bareRe.exec(markup)) !== null) {
    push(m[1], "");
  }
  var seen = {};
  return found.filter(function(e) {
    if (seen[e.url])
      return false;
    seen[e.url] = true;
    return true;
  });
}
function cleanPartTitle(title) {
  return String(title || "").replace(/\s*\d{1,2}(?:st|nd|rd|th)\s+\w+\s+\d{4}\s*$/i, "").trim();
}
function resolveBackend(url, referer, fetchImpl, ctx) {
  if (MEDIA_META_RE.test(url)) {
    var metaBase = url.slice(0, url.lastIndexOf("/") + 1);
    return fetchJson(fetchImpl, url).then(function(meta) {
      if (!meta || !meta.source || !meta.source.file)
        return null;
      var abs = function(u) {
        return u && u.indexOf("http") !== 0 ? metaBase + u : u;
      };
      return {
        backend: "dstshndisk",
        kind: "mp4",
        quality: "480p",
        url: abs(meta.source.file),
        fallbackUrl: abs(meta.source.fallbackFile),
        size: "",
        sizeBytes: 0,
        sourceTag: cleanPartTitle(meta.source.title),
        headers: null
      };
    });
  }
  var vkM = url.match(VK_EMBED_RE);
  if (vkM) {
    var embedUrl = "https://" + vkM[0].replace(/^https?:\/\//i, "");
    return resolveVkPlayer(embedUrl, referer, { fetchImpl }).then(function(sources) {
      var real = (sources || []).filter(function(s) {
        return !isPlaceholderUrl(s.url);
      });
      if (real.length === 0)
        return null;
      var best = real[0];
      var stream = {
        backend: embedUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime",
        kind: "mp4",
        quality: best.quality || "unknown",
        url: best.url,
        size: "",
        sizeBytes: 0,
        sourceTag: ctx.label || "",
        headers: best.headers
      };
      return fetchContentLength(fetchImpl, best.url, best.headers).then(function(sizeBytes) {
        stream.size = formatBytes(sizeBytes);
        stream.sizeBytes = sizeBytes;
        return stream;
      });
    });
  }
  var fM = url.match(FLOW_RE);
  if (fM) {
    var flowUrl = fM[0].indexOf("http") === 0 ? fM[0] : "https://" + fM[0];
    return resolveFlowPlayer(flowUrl, referer, { fetchImpl }).then(function(stream) {
      if (stream && ctx.label && !stream.sourceTag)
        stream.sourceTag = ctx.label;
      return stream;
    });
  }
  if (UPBOLT_RE.test(url)) {
    return resolveUpbolt(url.indexOf("http") === 0 ? url : "https://" + url, {
      fetchImpl
    }).then(function(stream) {
      if (stream && ctx.label && !stream.sourceTag)
        stream.sourceTag = ctx.label;
      return stream;
    });
  }
  if (M3U8_RE.test(url)) {
    return fetchText(fetchImpl, url, referer ? { headers: { Referer: referer } } : void 0).then(function(raw) {
      var variants = raw ? parseHlsMasterPlaylist(raw, url) : [];
      var top = variants[0] || {};
      var best = variants.reduce(function(acc, v) {
        return v.bandwidth > (acc.bandwidth || 0) ? v : acc;
      }, top);
      return {
        backend: url.indexOf("yandex") !== -1 ? "yandex" : "hls",
        kind: "hls",
        quality: top.height ? top.height + "p" : "",
        bandwidth: best.bandwidth || 0,
        url,
        size: "",
        sizeBytes: 0,
        sourceTag: ctx.label || "",
        headers: null
      };
    });
  }
  if (MP4_RE.test(url)) {
    return Promise.resolve({
      backend: "mp4",
      kind: "mp4",
      quality: "",
      url,
      size: "",
      sizeBytes: 0,
      sourceTag: ctx.label || "",
      headers: null
    });
  }
  return Promise.resolve(null);
}
function candidateKey(url) {
  var m;
  if (m = url.match(/flow\.tvlogy\.to\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/i)) {
    return "flow:" + m[1];
  }
  if (m = url.match(/(vkspeed|vkprime)\.com\/embed-([A-Za-z0-9_-]+)/i)) {
    return m[1].toLowerCase() + ":" + m[2];
  }
  if (m = url.match(/media_meta\.php\?v=([^&]+)/i)) {
    return "meta:" + m[1];
  }
  if (m = url.match(/upbolt\.to\/(?:emb-|e\/)([A-Za-z0-9_-]+)/i)) {
    return "upbolt:" + m[1];
  }
  return url;
}
function partitionUrls(markup, pageUrl, cfg) {
  var harvested = harvestPage(markup, pageUrl);
  var backends = [];
  var hops = [];
  var hopSeen = {};
  var backendSeen = {};
  harvested.forEach(function(entry) {
    var urls = [entry];
    (cfg.transforms || []).forEach(function(t) {
      var next = [];
      urls.forEach(function(u) {
        var mm = u.url.match(t.match);
        if (mm) {
          var out = t.expand(mm, u.url) || [];
          out.forEach(function(nu) {
            next.push(
              typeof nu === "string" ? { url: nu, label: u.label } : { url: nu.url, label: nu.label || u.label }
            );
          });
        } else {
          next.push(u);
        }
      });
      urls = next;
    });
    urls.forEach(function(u) {
      var url = u.url;
      var key = candidateKey(url);
      if (MEDIA_META_RE.test(url) || VK_EMBED_RE.test(url) || FLOW_RE.test(url) || M3U8_RE.test(url) || MP4_RE.test(url) || UPBOLT_RE.test(url)) {
        if (!backendSeen[key]) {
          backendSeen[key] = true;
          backends.push({ url, label: u.label });
        }
        return;
      }
      var isHop = (HOP_PATH_RE.test(url) || (cfg.extraHopRe || []).some(function(re) {
        return re.test(url);
      })) && !JUNK_RE.test(url) && !(cfg.skipHopRe && cfg.skipHopRe.test(url));
      if (isHop && !hopSeen[url]) {
        hopSeen[url] = true;
        hops.push({ url, label: u.label });
      }
    });
  });
  return { backends, hops };
}
function resolvePost(fetchImpl, postUrl, cfg) {
  var maxHops = cfg.maxHops || 8;
  return fetchImpl(postUrl, { headers: BROWSER_HEADERS }).then(function(res) {
    return res ? res.text() : null;
  }).then(function(post) {
    if (!post)
      return [];
    var found = partitionUrls(post, postUrl, cfg);
    var backendJobs = found.backends.map(function(b) {
      return resolveBackend(b.url, postUrl, fetchImpl, { label: b.label }).catch(function() {
        return null;
      });
    });
    var hopJobs = found.hops.slice(0, maxHops).map(function(hop) {
      return fetchImpl(hop.url, {
        headers: { Referer: postUrl, "User-Agent": BROWSER_HEADERS["User-Agent"] }
      }).then(function(res) {
        return res ? res.text() : null;
      }).then(function(hopPage) {
        if (!hopPage)
          return [];
        var inner = partitionUrls(hopPage, hop.url, cfg);
        var hopTag = cfg.hopTag ? cfg.hopTag(hop.url) : hop.label || "";
        return Promise.all(
          inner.backends.map(function(b) {
            return resolveBackend(b.url, hop.url, fetchImpl, {
              label: b.label || hopTag
            }).catch(function() {
              return null;
            });
          })
        );
      }).catch(function() {
        return [];
      });
    });
    return Promise.all([Promise.all(backendJobs), Promise.all(hopJobs)]).then(function(groups) {
      var streams = [];
      groups[0].forEach(function(s) {
        if (s)
          streams.push(s);
      });
      groups[1].forEach(function(set) {
        (set || []).forEach(function(s) {
          if (s)
            streams.push(s);
        });
      });
      return dedupeStreams(streams);
    });
  }).catch(function() {
    return [];
  });
}
function displayBackend2(backend) {
  return String(backend || "source").replace(/(^|[-_\s]+)([a-z])/g, function(_m, prefix, ch) {
    return prefix + ch.toUpperCase();
  }).replace(/[-_]+/g, "");
}
function wpSearchUrls(request, siteBase, searchPath, slugCandidates2, datedFirst) {
  var dateSlug = episodeDateSlug(request.airDate);
  var terms = function(s) {
    return encodeURIComponent(s.replace(/-/g, " ")).replace(/%20/g, "+");
  };
  var urls = [];
  var slugs = slugCandidates2.slice(0, 3);
  if (dateSlug) {
    var dq = dateSlug.replace(/-/g, " ");
    slugs.forEach(function(s) {
      urls.push(siteBase + searchPath + encodeURIComponent(s.replace(/-/g, " ") + " " + dq).replace(/%20/g, "+"));
    });
  }
  slugs.forEach(function(s) {
    urls.push(siteBase + searchPath + terms(s));
  });
  return dedupe(urls);
}
function chainProvider(cfg) {
  var logTag = "[" + cfg.name + "]";
  function slugVariants(request) {
    var candidates = request.slugCandidates || [];
    if (!cfg.stripTrailingS)
      return candidates;
    return dedupe(
      candidates.map(function(slug) {
        return slug.replace(/-s(?=-|$)/g, "s");
      }).concat(candidates)
    );
  }
  function searchUrls(request) {
    if (cfg.searchUrls)
      return cfg.searchUrls(request, slugVariants(request));
    return wpSearchUrls(request, cfg.siteBase, cfg.searchPath || "/?s=", slugVariants(request));
  }
  function postCandidates(markup, request) {
    if (cfg.postCandidates)
      return cfg.postCandidates(markup, request);
    return episodePostCandidates(links(markup), request, cfg.hostRe, cfg.nonPostRe);
  }
  function directUrls(request) {
    return cfg.postUrls ? cfg.postUrls(request, slugVariants(request)) : [];
  }
  function listingUrls(request) {
    return cfg.listingUrls ? cfg.listingUrls(request, slugVariants(request)) : [];
  }
  function postsFromPages(fetchImpl, urls, request) {
    if (urls.length === 0)
      return Promise.resolve(null);
    return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function(page) {
      var cands = postCandidates(page, request);
      return cands.length > 0 ? cands : null;
    });
  }
  function resolveRequest(request, options) {
    options = options || {};
    var fetchImpl = cachingFetch(resolveFetch(options));
    var maxPosts = cfg.maxPosts || 2;
    function resolvePosts(urls) {
      if (!urls || urls.length === 0)
        return Promise.resolve([]);
      return Promise.all(
        urls.slice(0, maxPosts).map(function(url) {
          return resolvePost(fetchImpl, url, cfg);
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
    }
    function fromDiscovery() {
      return postsFromPages(fetchImpl, searchUrls(request), request).then(function(posts) {
        if (posts && posts.length > 0)
          return resolvePosts(posts);
        return postsFromPages(fetchImpl, listingUrls(request), request).then(resolvePosts);
      });
    }
    var direct = directUrls(request);
    if (direct.length > 0) {
      var idx = 0;
      var tryDirect = function() {
        if (idx >= direct.length)
          return Promise.resolve([]);
        var url = direct[idx];
        idx += 1;
        return resolvePost(fetchImpl, url, cfg).then(function(streams) {
          return streams.length > 0 ? streams : tryDirect();
        });
      };
      return tryDirect().then(function(streams) {
        return streams.length > 0 ? streams : fromDiscovery();
      });
    }
    return fromDiscovery();
  }
  function getStreamsForRequest(request, options) {
    return resolveRequest(request, options).then(function(resolved) {
      return sortStreamsBest(dedupeStreams(resolved), request.runtimeMinutes).map(function(stream, idx) {
        var base;
        if (cfg.streamName) {
          base = cfg.streamName(stream);
        } else {
          base = cfg.name + " " + displayBackend2(stream.backend) + (stream.sourceTag ? " (" + stream.sourceTag + ")" : "");
        }
        stream.name = (idx < 9 ? "0" : "") + (idx + 1) + " " + base;
        return toNuvioStream(request, stream);
      });
    }).catch(function(error) {
      console.log(logTag + " resolver failed: " + error.message);
      return [];
    });
  }
  function getStreams2(tmdbId, mediaType, season, episode) {
    if (cfg.mediaTypes && cfg.mediaTypes.indexOf(mediaType) === -1) {
      return Promise.resolve([]);
    }
    return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY }).then(function(request) {
      return getStreamsForRequest(request, { fetchImpl: typeof fetch !== "undefined" ? fetch : null });
    }).catch(function(error) {
      console.log(logTag + " getStreams failed: " + error.message);
      return [];
    });
  }
  return { getStreams: getStreams2, getStreamsForRequest };
}

// src/tellynagari-com/index.js
var ARTICLEWEB = "https://articleweb.xyz/vid/";
var GATE_MAP = { girmeet: "gdrive", kratike: "vkspeed" };
var GATE_PROBES = ["gdrive", "vkspeed"];
var GATE_URL_RE = /\/usn\/([A-Za-z0-9_-]+)\.php\?[^"']*docid=([A-Za-z0-9_-]+)/i;
var SITE_HOST_RE = /^https:\/\/(?:www\.)?tellynagari\.com\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$|\/(about|contact|dmca|privacy|terms)/i;
var LATEST_WINDOW_MS = 10 * 24 * 60 * 60 * 1e3;
var provider = chainProvider({
  name: "TellyNagari",
  siteBase: "https://tellynagari.com",
  searchPath: "/?s=",
  hostRe: SITE_HOST_RE,
  nonPostRe: NON_POST_RE,
  mediaTypes: ["tv"],
  // tellyduniya gate URL -> articleweb player page(s). Known gates map
  // directly; unknown gates probe both known paths.
  transforms: [
    {
      match: GATE_URL_RE,
      expand: function(m) {
        var gate = m[1].toLowerCase();
        var paths = GATE_MAP[gate] ? [GATE_MAP[gate]] : GATE_PROBES;
        return paths.map(function(p) {
          return ARTICLEWEB + p + ".php?id=" + encodeURIComponent(m[2]);
        });
      }
    }
  ],
  // Tellynagari keeps only the LATEST episode post per show: strict matching
  // misses older eps, and an air-dated request must not be served the newest
  // post. Only undated requests may accept a single fresh dated post.
  postCandidates: function(markup, request) {
    var hrefs = links(markup);
    var strict = episodePostCandidates(hrefs, request, SITE_HOST_RE, NON_POST_RE);
    if (strict.length > 0)
      return strict;
    if (request.airDate)
      return [];
    var dated = dedupe(
      hrefs.filter(function(href) {
        return SITE_HOST_RE.test(href) && !NON_POST_RE.test(href) && slugTimestamp(href) > 0 && (request.slugCandidates || []).some(function(slug) {
          return href.toLowerCase().indexOf(slug) !== -1;
        });
      })
    );
    if (dated.length !== 1)
      return [];
    if (Math.abs(Date.now() - slugTimestamp(dated[0])) > LATEST_WINDOW_MS)
      return [];
    return dated;
  }
});
function getStreams(tmdbId, mediaType, season, episode) {
  return provider.getStreams(tmdbId, mediaType, season, episode);
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
