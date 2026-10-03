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
    (hrefs || []).filter(function(href) {
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
    if (target)
      return byTs[target];
  }
  return [];
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

// src/tellynagari-com/index.js
var SITE_BASE = "https://tellynagari.com";
var SEARCH_PATH = "/?s=";
var SITE_HOST_RE = /^https:\/\/(?:www\.)?tellynagari\.com\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$|\/(about|contact|dmca|privacy|terms)/i;
var ARTICLEWEB = "https://articleweb.xyz/vid/";
var GATE_MAP = {
  girmeet: "gdrive",
  kratike: "vkspeed"
};
var GATE_PROBES = ["gdrive", "vkspeed"];
var YANDEX_RE = /(https?:\/\/streaming\.disk\.yandex\.net\/hls\/[^"'\s<>]+m3u8[^"'\s<>]*)/i;
var GENERIC_M3U8_RE = /(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i;
var VK_EMBED_RE = /(vkspeed\.com|vkprime\.com)\/embed-[A-Za-z0-9_-]+(?:-\d+x\d+)?\.html/i;
function displayBackend2(backend) {
  return String(backend || "source").replace(/(^|[-_\s]+)([a-z])/g, function(_m, prefix, ch) {
    return prefix + ch.toUpperCase();
  }).replace(/[-_]+/g, "");
}
function buildSearchUrls(request) {
  return (request.slugCandidates || []).slice(0, 3).map(function(slug) {
    return SITE_BASE + SEARCH_PATH + encodeURIComponent(slug.replace(/-/g, " ")).replace(/%20/g, "+");
  });
}
var LATEST_WINDOW_MS = 10 * 24 * 60 * 60 * 1e3;
function episodePageCandidates(markup, request) {
  var hrefs = links(markup);
  var strict = episodePostCandidates(hrefs, request, SITE_HOST_RE, NON_POST_RE);
  if (strict.length > 0)
    return strict;
  if (request.airDate)
    return [];
  var dated = dedupe(hrefs.filter(function(href) {
    return SITE_HOST_RE.test(href) && !NON_POST_RE.test(href) && slugTimestamp(href) > 0 && (request.slugCandidates || []).some(function(slug) {
      return href.toLowerCase().indexOf(slug) !== -1;
    });
  }));
  if (dated.length !== 1)
    return [];
  var ts = slugTimestamp(dated[0]);
  if (Math.abs(Date.now() - ts) > LATEST_WINDOW_MS)
    return [];
  return dated;
}
function findGateLinks(markup) {
  var gates = [];
  var re = /<a\b[^>]*itm\('([^']+)'\)[^>]*>([^<]*)<\/a>/gi;
  var m;
  while ((m = re.exec(markup)) !== null) {
    var gateMatch = m[1].match(/\/usn\/([A-Za-z0-9_-]+)\.php\?.*docid=([A-Za-z0-9_-]+)/i);
    if (!gateMatch)
      continue;
    var labelMatch = m[2].match(/\(([^)]+)\)/);
    gates.push({
      gate: gateMatch[1],
      docid: gateMatch[2],
      label: labelMatch ? labelMatch[1] : gateMatch[1]
    });
  }
  var seen = {};
  return gates.filter(function(g) {
    var key = g.gate + "|" + g.docid;
    if (seen[key])
      return false;
    seen[key] = true;
    return true;
  });
}
function findGatesFromPages(fetchImpl, urls) {
  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function(page) {
    var gates = findGateLinks(page);
    return gates.length > 0 ? { gates, pageUrl: urls[0] } : null;
  }).then(function(hit) {
    return hit ? hit.gates : [];
  });
}
function candidatePaths(gate) {
  var paths = [];
  if (GATE_MAP[gate])
    paths.push(GATE_MAP[gate]);
  GATE_PROBES.forEach(function(p) {
    if (paths.indexOf(p) === -1)
      paths.push(p);
  });
  return paths;
}
function resolveGate(fetchImpl, gate, docid, referer) {
  var paths = candidatePaths(gate);
  var idx = 0;
  function tryNext() {
    if (idx >= paths.length)
      return Promise.resolve(null);
    var pageUrl = ARTICLEWEB + paths[idx] + ".php?id=" + encodeURIComponent(docid);
    idx += 1;
    return fetchImpl(pageUrl, { headers: { Referer: referer, "User-Agent": BROWSER_HEADERS["User-Agent"] } }).then(function(res) {
      return res ? res.text() : null;
    }).then(function(page) {
      if (!page)
        return tryNext();
      var yx = page.match(YANDEX_RE) || page.match(GENERIC_M3U8_RE);
      if (yx) {
        return { kind: "hls", backend: "yandex", url: yx[1] };
      }
      var vk = page.match(VK_EMBED_RE);
      if (vk) {
        return { kind: "vk", backend: "vkspeed", url: "https://" + vk[0] };
      }
      return tryNext();
    }).catch(function() {
      return tryNext();
    });
  }
  return tryNext();
}
function toStream(fetchImpl, resolved, label, referer) {
  if (resolved.kind === "hls") {
    return Promise.resolve({
      backend: resolved.backend,
      kind: "hls",
      quality: "",
      url: resolved.url,
      size: "",
      sizeBytes: 0,
      sourceTag: label,
      headers: null
    });
  }
  return resolveVkPlayer(resolved.url, referer, { fetchImpl }).then(function(sources) {
    var real = (sources || []).filter(function(s) {
      return !isPlaceholderUrl(s.url);
    });
    if (real.length === 0)
      return null;
    var best = real[0];
    var stream = {
      backend: resolved.backend,
      kind: "mp4",
      quality: best.quality || "unknown",
      url: best.url,
      size: "",
      sizeBytes: 0,
      sourceTag: label,
      headers: best.headers
    };
    return fetchContentLength(fetchImpl, best.url, best.headers).then(function(sizeBytes) {
      stream.size = formatBytes(sizeBytes);
      stream.sizeBytes = sizeBytes;
      return stream;
    });
  });
}
function resolveGates(fetchImpl, gates, referer) {
  return Promise.all(gates.map(function(g) {
    return resolveGate(fetchImpl, g.gate, g.docid, referer).then(function(resolved) {
      if (!resolved)
        return null;
      return toStream(fetchImpl, resolved, g.label, referer);
    }).catch(function(error) {
      console.log("[TellyNagari] gate " + g.gate + " failed: " + (error && error.message));
      return null;
    });
  })).then(function(streams) {
    return streams.filter(function(s) {
      return s !== null;
    });
  });
}
function resolveTellyNagari(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return fetchFirstResult(fetchImpl, buildSearchUrls(request), { headers: BROWSER_HEADERS }, function(page) {
    var episodeUrls = episodePageCandidates(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function(episodeUrls) {
    if (!episodeUrls)
      return [];
    return findGatesFromPages(fetchImpl, episodeUrls).then(function(gates) {
      return resolveGates(fetchImpl, gates.slice(0, 6), episodeUrls[0] || SITE_BASE + "/");
    });
  });
}
function getStreamsForRequest(request, options) {
  return resolveTellyNagari(request, options).then(function(resolved) {
    return dedupeStreams(resolved).map(function(stream) {
      stream.name = "TellyNagari " + displayBackend2(stream.backend) + (stream.sourceTag ? " (" + stream.sourceTag + ")" : "");
      return toNuvioStream(request, stream);
    });
  }).catch(function(error) {
    console.log("[TellyNagari] resolver failed: " + error.message);
    return [];
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv")
    return Promise.resolve([]);
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY }).then(function(request) {
    return getStreamsForRequest(request, { fetchImpl: typeof fetch !== "undefined" ? fetch : null });
  }).catch(function(error) {
    console.log("[TellyNagari] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
