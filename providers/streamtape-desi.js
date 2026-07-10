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
  var airYear = request.airYear || String(request.airDate || "").substring(0, 4);
  if (airYear)
    years.push(airYear);
  var currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  if (years.indexOf(String(currentYear)) === -1) {
    years.push(String(currentYear));
  }
  if (airYear) {
    var airYearNum = Number(airYear);
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
  for (var ps = 0; ps < slugs.length; ps += 1) {
    for (var py = 0; py < years.length; py += 1) {
      urls.push(
        WATCH_MOVIES_BASE + slugs[ps] + "-" + years[py] + "-ep-" + String(episode).padStart(2, "0") + expandedSuffixes[0]
      );
    }
  }
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
  var airYear = request.airYear || String(request.airDate || "").substring(0, 4);
  if (airYear)
    years.push(airYear);
  var currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  if (years.indexOf(String(currentYear)) === -1) {
    years.push(String(currentYear));
  }
  if (airYear) {
    var airYearNum = Number(airYear);
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
  var slugs = slugCandidates(title).slice(0, 2);
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
  if (searchUrls.length === 0)
    return Promise.resolve([]);
  return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function(page) {
    var episodeUrls = episodeCandidateFn(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function(episodeUrls) {
    return episodeUrls || [];
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
        var headers = {
          Referer: resolved.embedUrl,
          "User-Agent": UA
        };
        var stream = {
          kind: "mp4",
          quality: entry.quality,
          url: resolved.cdnUrl,
          size: "",
          sizeBytes: 0,
          duration: 0,
          sourceTag: "",
          headers
        };
        return fetchContentLength(fetchImpl, resolved.cdnUrl, headers).then(function(sizeBytes) {
          stream.size = formatBytes(sizeBytes);
          stream.sizeBytes = sizeBytes;
          return stream;
        });
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
  function firstPage(urls) {
    return fetchFirstResult(fetchImpl, urls.slice(0, 8), { headers: BROWSER_HEADERS }, function(html, url) {
      return { url, html };
    });
  }
  if (request.mediaType === "movie") {
    return firstPage(buildWatchMoviesMovieUrls(request)).then(function(page) {
      if (!page || !watchMoviesHasStreamTape(page.html))
        return [];
      return resolveStreamTapeFromPages(fetchImpl, [page]);
    });
  }
  return firstPage(buildWatchMoviesEpisodeUrls(request)).then(function(page) {
    if (page && watchMoviesHasStreamTape(page.html)) {
      return resolveStreamTapeFromPages(fetchImpl, [page]);
    }
    return searchSite(fetchImpl, buildUlluhdSearchUrls(request), ulluhdEpisodeCandidates, request).then(function(episodeUrls) {
      return firstPage(episodeUrls);
    }).then(function(ulluhdPage) {
      if (!ulluhdPage || !watchMoviesHasStreamTape(ulluhdPage.html))
        return [];
      return resolveStreamTapeFromPages(fetchImpl, [ulluhdPage]);
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
