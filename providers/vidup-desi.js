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

// src/lib/vidup.js
var VIDUP_HOSTS = ["vidup.site"];
var BLOGGER_VIDEO_PAGE = "https://www.blogger.com/video.g?token=";
var BLOGGER_BATCH_BASE = "https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute";
var BLOGGER_RPC_ID = "WcwnYd";
var ITAG_QUALITY = {
  18: "360p",
  22: "720p"
};
function isVidUpUrl(url) {
  var str = String(url || "");
  for (var i = 0; i < VIDUP_HOSTS.length; i++) {
    if (str.indexOf(VIDUP_HOSTS[i]) !== -1)
      return true;
  }
  return false;
}
function extractBloggerToken(html) {
  var match = String(html || "").match(/blogger\.com\/video\.g\?token=([^"&]+)/);
  return match ? match[1] : "";
}
function extractBloggerSession(html) {
  var text = String(html || "");
  var sidMatch = text.match(/"FdrFJe":"([^"]+)"/);
  var blMatch = text.match(/"cfb2h":"([^"]+)"/);
  return {
    formSessionId: sidMatch ? sidMatch[1] : "",
    blogId: blMatch ? blMatch[1] : ""
  };
}
function bloggerBatchExecute(fetchImpl, token, session) {
  var reqid = String(Date.now() / 1e3 % 86400 | 0);
  var url = BLOGGER_BATCH_BASE + "?rpcids=" + BLOGGER_RPC_ID + "&source-path=%2Fvideo.g&f.sid=" + encodeURIComponent(session.formSessionId) + "&bl=" + encodeURIComponent(session.blogId) + "&hl=en-US&_reqid=" + reqid + "&rt=c";
  var innerParam = '["' + token + '","",0]';
  var reqPayload = JSON.stringify([[[BLOGGER_RPC_ID, innerParam, null, "generic"]]]);
  var body = "f.req=" + encodeURIComponent(reqPayload);
  return fetchImpl(url, {
    method: "POST",
    headers: Object.assign({}, BROWSER_HEADERS, {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Referer": "https://www.blogger.com/",
      "X-Same-Domain": "1"
    }),
    body
  }).then(function(response) {
    if (!response || response.ok === false)
      return null;
    return response.text();
  }).catch(function() {
    return null;
  });
}
function parseBloggerVideoUrls(responseText) {
  var text = String(responseText || "");
  if (!text)
    return [];
  text = text.replace(/\\\\u003d/g, "=").replace(/\\\\u0026/g, "&");
  text = text.replace(/\\\\u003f/g, "?").replace(/\\\\u002f/g, "/");
  text = text.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
  text = text.replace(/\\u003f/g, "?").replace(/\\u002f/g, "/");
  var urlRe = /https:\/\/rr\d+---sn-[a-z0-9]+\.googlevideo\.com\/videoplayback[^"]+/g;
  var itagRe = /itag=(\d+)/;
  var results = [];
  var match;
  while ((match = urlRe.exec(text)) !== null) {
    var url = match[0];
    var itagMatch = url.match(itagRe);
    var itag = itagMatch ? Number(itagMatch[1]) : 0;
    var quality = ITAG_QUALITY[itag] || "unknown";
    results.push({ url, itag, quality });
  }
  var seen = /* @__PURE__ */ new Set();
  var deduped = [];
  for (var i = 0; i < results.length; i++) {
    if (!seen.has(results[i].url)) {
      seen.add(results[i].url);
      deduped.push(results[i]);
    }
  }
  deduped.sort(function(a, b) {
    return b.itag - a.itag;
  });
  return deduped;
}
function resolveVidUpEmbed(fetchImpl, vidupUrl) {
  return fetchText(fetchImpl, vidupUrl, { headers: BROWSER_HEADERS }).then(function(html) {
    if (!html)
      return { token: "", session: null };
    var token = extractBloggerToken(html);
    if (!token)
      return { token: "", session: null };
    return fetchText(fetchImpl, BLOGGER_VIDEO_PAGE + token, { headers: BROWSER_HEADERS }).then(function(bloggerHtml) {
      if (!bloggerHtml)
        return { token, session: null };
      return { token, session: extractBloggerSession(bloggerHtml) };
    });
  }).then(function(result) {
    if (!result.token || !result.session || !result.session.formSessionId)
      return [];
    return bloggerBatchExecute(fetchImpl, result.token, result.session);
  }).then(function(responseText) {
    if (!responseText)
      return [];
    var urls = parseBloggerVideoUrls(responseText);
    return urls.map(function(item) {
      return {
        url: item.url,
        quality: item.quality,
        name: "Blogger",
        kind: "mp4",
        sourceTag: "blogger"
      };
    });
  }).catch(function() {
    return [];
  });
}

// src/vidup-desi/index.js
var SITES = [
  {
    base: "https://yodesionline.net",
    episodePatterns: [
      "/{slug}-{date}-full-episode-{num}/"
    ]
  },
  {
    base: "https://desiserialonline.su",
    episodePatterns: [
      "/{slug}-{date}-video-episode-{num}/"
    ]
  }
];
var SEARCH_PATH = "/?s=";
function buildEpisodeUrls(site, slugCandidates2, dateSlug, episodeNum) {
  var urls = [];
  for (var s = 0; s < slugCandidates2.length; s++) {
    for (var p = 0; p < site.episodePatterns.length; p++) {
      var path = site.episodePatterns[p].replace("{slug}", slugCandidates2[s]).replace("{date}", dateSlug).replace("{num}", episodeNum);
      urls.push(site.base + path);
    }
  }
  return urls;
}
function buildAllEpisodeUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug)
    return [];
  var allUrls = [];
  for (var i = 0; i < SITES.length; i++) {
    var siteUrls = buildEpisodeUrls(SITES[i], request.slugCandidates, dateSlug, request.episode);
    allUrls = allUrls.concat(siteUrls);
  }
  return allUrls;
}
function buildSearchUrls(request) {
  var urls = [];
  var query = encodeURIComponent(request.title + " episode " + request.episode);
  for (var i = 0; i < SITES.length; i++) {
    urls.push(SITES[i].base + SEARCH_PATH + query);
  }
  return urls;
}
function extractVidUpEmbeds(html) {
  var candidates = iframeSrcCandidates(html);
  return dedupe(candidates.filter(isVidUpUrl));
}
function extractEpisodeLinks(html, episodeNum) {
  var linkRe = /href="(https?:\/\/[^"]+\/[^"]*episode[^"]*)"/gi;
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
    return resolveVidUpEmbed(fetchImpl, embedUrl);
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
  var urls = buildAllEpisodeUrls(request);
  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function(html) {
    var embeds = extractVidUpEmbeds(html);
    if (embeds.length === 0)
      return null;
    return embeds;
  }).then(function(embeds) {
    if (embeds) {
      return resolveAllEmbeds(fetchImpl, embeds);
    }
    var searchUrls = buildSearchUrls(request);
    return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function(html) {
      var episodeLinks = extractEpisodeLinks(html, request.episode);
      return episodeLinks.length > 0 ? episodeLinks : null;
    }).then(function(links) {
      if (!links || links.length === 0)
        return [];
      return fetchFirstResult(fetchImpl, links, { headers: BROWSER_HEADERS }, function(html) {
        var embeds2 = extractVidUpEmbeds(html);
        return embeds2.length > 0 ? embeds2 : null;
      }).then(function(searchEmbeds) {
        if (!searchEmbeds)
          return [];
        return resolveAllEmbeds(fetchImpl, searchEmbeds);
      });
    });
  }).then(function(resolved) {
    return dedupeStreams(resolved).map(function(stream) {
      stream.name = "VidUp Desi";
      return toNuvioStream(request, stream);
    });
  }).catch(function(error) {
    console.log("[VidUp Desi] resolver failed: " + error.message);
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
    console.log("[VidUp Desi] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
