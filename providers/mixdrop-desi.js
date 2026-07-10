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
function fetchTextTimeout(fetchImpl, url, options, ms) {
  options = options || {};
  ms = ms || 4e3;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    options = Object.assign({}, options, { signal: AbortSignal.timeout(ms) });
  }
  return fetchText(fetchImpl, url, options);
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

// src/mixdrop-desi/index.js
var MIXDROP_DOMAINS = [
  "mixdrop.ag",
  "mixdrop.to",
  "mxdrop.to",
  "mixdrop.ps",
  "mixdrop.sx",
  "mixdrop.ms",
  "mixdrop.is",
  "mixdrop.si",
  "mixdrop.bz",
  "mixdrop.nu",
  "mixdrop.sb",
  "mixdrop.my",
  "mixdrop.sn",
  "mixdrop.cv",
  "mixdrop.top",
  "mixdrop.co",
  "mixdrop.vc",
  "mixdrop.club",
  "m1xdrop.net",
  "m1xdrop.com",
  "m1xdrop.bz",
  "m1xdrop.click",
  "miixdrop.net",
  "mixdrops.xyz",
  "mixdrop21.net",
  "mixdrop23.net",
  "mdy48tn97.com",
  "mdbekjwqa.pw",
  "mdfx9dc8n.net",
  "mdzsmutpcvykb.net",
  "md3b0j6hj.com"
];
var MIXDROP_DOMAIN_RE = new RegExp(
  "(" + MIXDROP_DOMAINS.map(function(d) {
    return d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("|") + ")",
  "i"
);
var WATCH_MOVIES_BASE = "https://www.watch-movies.com.pk/";
var EPISODE_SUFFIXES = [
  "-hindi-season-{season}-watch-online-hd-print-free-download/",
  "-hindi-reality-show-watch-online-hd-print-free-download/",
  "-hindi-dubbed-season-{season}-watch-online-hd-print-free-download/"
];
var MOVIE_SUFFIXES = [
  "-hindi-full-movie-watch-online-hd-print-free-download/",
  "-hindi-dubbed-full-movie-watch-online-hd-print-free-download/"
];
var EPISODE_LABELS = ["ep", "episode"];
function normalizeMixDropUrl(url) {
  var u = String(url || "").trim();
  if (u.indexOf("//") === 0) {
    u = "https:" + u;
  }
  u = u.replace(/\/f\//, "/e/");
  return u;
}
function mixDropId(url) {
  var m = String(url || "").match(/\/(?:e|f)\/([a-z0-9]+)/i);
  return m ? m[1] : "";
}
function isMixDropUrl(url) {
  return MIXDROP_DOMAIN_RE.test(String(url || ""));
}
function detectQuality(text) {
  var t = String(text || "");
  var match = t.match(/\b(\d{3,4})p\b/i);
  if (match) {
    return match[1] + "p";
  }
  if (/\bhd\b/i.test(t)) {
    return "720p";
  }
  if (/\bfull\s*hd\b/i.test(t) || /\bfhd\b/i.test(t)) {
    return "1080p";
  }
  if (/\bsd\b/i.test(t)) {
    return "480p";
  }
  return "unknown";
}
function resolveMixDrop(embedUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var url = normalizeMixDropUrl(embedUrl);
  var fileId = mixDropId(url);
  return fetchText(fetchImpl, url, browserHeaders(refererUrl)).then(function(html) {
    if (!html) {
      console.log("[MixDrop] embed page fetch returned empty for " + url);
      return null;
    }
    if (/WE ARE SORRY/i.test(html) || /can't find the (file|video)/i.test(html)) {
      console.log("[MixDrop] video appears dead/removed for " + url);
      return null;
    }
    var unpacked = unpack(html);
    if (!unpacked) {
      console.log("[MixDrop] no packer block found in embed page " + url);
      return null;
    }
    var wurlMatch = unpacked.match(/MDCore\.wurl\s*=\s*["']([^"']+)["']/);
    if (!wurlMatch) {
      console.log("[MixDrop] MDCore.wurl not found in unpacked code for " + url);
      return null;
    }
    var mp4Url = wurlMatch[1];
    if (!mp4Url) {
      return null;
    }
    if (mp4Url.indexOf("//") === 0) {
      mp4Url = "https:" + mp4Url;
    }
    var vfileMatch = unpacked.match(/MDCore\.vfile\s*=\s*["']([^"']+)["']/);
    var filename = vfileMatch ? vfileMatch[1] : "";
    var posterMatch = unpacked.match(/MDCore\.poster\s*=\s*["']([^"']+)["']/);
    var poster = posterMatch ? posterMatch[1] : "";
    var quality = detectQuality(filename + " " + poster + " " + mp4Url);
    var headers = { Referer: url, "User-Agent": UA };
    return fetchContentLength(fetchImpl, mp4Url, headers).then(function(contentLength) {
      return {
        backend: "mixdrop",
        kind: "mp4",
        quality,
        url: mp4Url,
        size: formatBytes(contentLength),
        duration: 0,
        sourceTag: "",
        headers,
        filename
      };
    });
  }).catch(function(err) {
    console.log("[MixDrop] resolveMixDrop error for " + url + ": " + (err && err.message || err));
    return null;
  });
}
function findMixDropEmbeds(markup) {
  var embeds = [];
  var iframeSrcs = iframeSrcCandidates(markup);
  for (var i = 0; i < iframeSrcs.length; i++) {
    var src = iframeSrcs[i];
    if (isMixDropUrl(src)) {
      embeds.push({ url: normalizeMixDropUrl(src), quality: "" });
    }
  }
  var allLinks = links(markup);
  for (var j = 0; j < allLinks.length; j++) {
    var href = allLinks[j];
    if (isMixDropUrl(href)) {
      var quality = extractQualityNearLink(markup, href);
      embeds.push({ url: normalizeMixDropUrl(href), quality });
    }
  }
  return dedupeMixDropEmbeds(embeds);
}
function dedupeMixDropEmbeds(embeds) {
  var byId = /* @__PURE__ */ new Map();
  for (var i = 0; i < embeds.length; i++) {
    var e = embeds[i];
    var id = mixDropId(e.url);
    if (!id) {
      continue;
    }
    if (!byId.has(id)) {
      byId.set(id, e);
    } else {
      var existing = byId.get(id);
      if (!existing.quality && e.quality) {
        byId.set(id, e);
      }
    }
  }
  return Array.from(byId.values());
}
function extractQualityNearLink(markup, href) {
  var text = String(markup || "");
  var idx = text.indexOf(href);
  if (idx === -1) {
    return "";
  }
  var before = text.slice(Math.max(0, idx - 200), idx);
  var after = text.slice(idx, idx + 200);
  var combined = before + after;
  var match = combined.match(/(\d{3,4})p\s*Quality\s*Links\s*MixDrop/i);
  if (match) {
    return match[1] + "p";
  }
  match = combined.match(/MixDrop\s*(\d{3,4})p/i);
  if (match) {
    return match[1] + "p";
  }
  match = combined.match(/(\d{3,4})p/i);
  if (match) {
    return match[1] + "p";
  }
  return "";
}
function buildEpisodePageUrls(request) {
  var urls = [];
  var slugs = slugCandidates(request.title);
  var season = request.season;
  var episode = request.episode;
  var epVariants = [
    String(episode),
    String(episode).padStart(2, "0"),
    String(episode).padStart(3, "0")
  ];
  epVariants = dedupe(epVariants);
  var epRanges = [];
  epRanges.push(episode + "-" + (episode + 1));
  if (episode > 1) {
    epRanges.push(episode - 1 + "-" + episode);
  }
  var ep2 = String(episode).padStart(2, "0");
  epRanges.push(ep2 + "-" + String(episode + 1).padStart(2, "0"));
  if (episode > 1) {
    epRanges.push(String(episode - 1).padStart(2, "0") + "-" + ep2);
  }
  var years = [];
  if (request.airDate) {
    var epYear = request.airDate.substring(0, 4);
    if (epYear) {
      years.push(epYear);
      years.push(String(Number(epYear) - 1));
    }
  }
  if (request.seasonAirDate) {
    var sYear = request.seasonAirDate.substring(0, 4);
    if (sYear && years.indexOf(sYear) === -1) {
      years.push(sYear);
    }
  }
  years = dedupe(years);
  var expandedSuffixes = EPISODE_SUFFIXES.map(function(s) {
    return s.replace(/\{season\}/g, String(season));
  });
  for (var i = 0; i < slugs.length; i++) {
    var slug = slugs[i];
    for (var yi = 0; yi < years.length; yi++) {
      var year = years[yi];
      for (var ei = 0; ei < epVariants.length; ei++) {
        var ep = epVariants[ei];
        for (var li = 0; li < EPISODE_LABELS.length; li++) {
          var label = EPISODE_LABELS[li];
          for (var si = 0; si < expandedSuffixes.length; si++) {
            urls.push(
              WATCH_MOVIES_BASE + slug + "-" + year + "-" + label + "-" + ep + expandedSuffixes[si]
            );
          }
        }
      }
      for (var ri = 0; ri < epRanges.length; ri++) {
        for (var si2 = 0; si2 < expandedSuffixes.length; si2++) {
          if (expandedSuffixes[si2].indexOf("reality-show") !== -1) {
            continue;
          }
          urls.push(
            WATCH_MOVIES_BASE + slug + "-" + year + "-ep-" + epRanges[ri] + expandedSuffixes[si2]
          );
        }
      }
      urls.push(
        WATCH_MOVIES_BASE + slug + "-" + year + "-hindi-season-" + season + "-complete-watch-online-hd-print-free-download/"
      );
    }
    for (var ei2 = 0; ei2 < epVariants.length; ei2++) {
      for (var li2 = 0; li2 < EPISODE_LABELS.length; li2++) {
        urls.push(
          WATCH_MOVIES_BASE + slug + "-" + EPISODE_LABELS[li2] + "-" + epVariants[ei2] + "-hindi-season-" + season + "-watch-online-hd-print-free-download/"
        );
      }
    }
  }
  return dedupe(urls);
}
function buildMoviePageUrls(request) {
  var urls = [];
  var slugs = slugCandidates(request.title);
  var years = [];
  if (request.airDate) {
    var releaseYear = request.airDate.substring(0, 4);
    if (releaseYear) {
      years.push(releaseYear);
      years.push(String(Number(releaseYear) - 1));
      years.push(String(Number(releaseYear) + 1));
    }
  }
  var currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  if (years.indexOf(String(currentYear)) === -1)
    years.push(String(currentYear));
  years = dedupe(years);
  for (var yi = 0; yi < years.length; yi++) {
    for (var i = 0; i < slugs.length; i++) {
      for (var si = 0; si < MOVIE_SUFFIXES.length; si++) {
        urls.push(WATCH_MOVIES_BASE + slugs[i] + "-" + years[yi] + MOVIE_SUFFIXES[si]);
      }
    }
  }
  for (var i2 = 0; i2 < slugs.length; i2++) {
    for (var si2 = 0; si2 < MOVIE_SUFFIXES.length; si2++) {
      urls.push(WATCH_MOVIES_BASE + slugs[i2] + MOVIE_SUFFIXES[si2]);
    }
  }
  return dedupe(urls);
}
function resolveFromEpisodePages(fetchImpl, episodeUrls) {
  if (episodeUrls.length === 0) {
    return Promise.resolve([]);
  }
  var PAGE_TIMEOUT_MS = 4e3;
  var BATCH = 6;
  var allEmbeds = [];
  var index = 0;
  function resolveEmbeds() {
    if (allEmbeds.length === 0)
      return Promise.resolve([]);
    return Promise.all(
      allEmbeds.map(function(embed) {
        return resolveMixDrop(embed.url, WATCH_MOVIES_BASE, { fetchImpl }).then(function(stream) {
          if (stream && embed.quality && stream.quality === "unknown") {
            stream.quality = embed.quality;
          }
          return stream;
        }).catch(function() {
          return null;
        });
      })
    ).then(function(resolved) {
      return dedupeStreams(resolved);
    });
  }
  function nextBatch() {
    if (allEmbeds.length > 0 || index >= episodeUrls.length) {
      return resolveEmbeds();
    }
    var batch = episodeUrls.slice(index, index + BATCH);
    index += BATCH;
    return Promise.all(
      batch.map(function(url) {
        return fetchTextTimeout(fetchImpl, url, { headers: BROWSER_HEADERS }, PAGE_TIMEOUT_MS);
      })
    ).then(function(pages) {
      for (var i = 0; i < pages.length; i++) {
        if (!pages[i])
          continue;
        var embeds = findMixDropEmbeds(pages[i]);
        for (var j = 0; j < embeds.length; j++) {
          allEmbeds.push(embeds[j]);
        }
      }
      return nextBatch();
    });
  }
  return nextBatch();
}
function resolveMixDropDesi(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  if (request.mediaType === "movie") {
    var movieUrls = buildMoviePageUrls(request);
    return resolveFromEpisodePages(fetchImpl, movieUrls);
  }
  var episodeUrls = buildEpisodePageUrls(request);
  return resolveFromEpisodePages(fetchImpl, episodeUrls);
}
function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return resolveMixDropDesi(request, { fetchImpl }).then(function(resolved) {
    return dedupeStreams(resolved).map(function(stream) {
      stream.name = "WatchMovies MixDrop";
      if (stream.sourceTag) {
        stream.name += " (" + stream.sourceTag + ")";
      }
      return toNuvioStream(request, stream);
    });
  }).catch(function(error) {
    console.log("[MixDrop Desi] resolver failed: " + error.message);
    return [];
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv" && mediaType !== "movie") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, {}).then(function(request) {
    return getStreamsForRequest(request, { fetchImpl: typeof fetch !== "undefined" ? fetch : null });
  }).catch(function(error) {
    console.log("[MixDrop Desi] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
