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

// src/lib/streamwish.js
var STREAMWISH_HOSTS = [
  "streamwish.com",
  "streamwish.to",
  "strcloud.club",
  "stape.fun",
  "streamtape.xyz",
  "streamtape.com",
  "streamtape.to",
  "wishembed.pro",
  "streamwish.org",
  "sfastwish.com",
  "strwish.com",
  "awish.pro",
  "embedwish.com",
  "swhoi.com",
  "hgcloud.to",
  "hglink.to",
  "mwish.pro",
  "dwish.pro",
  "streamwish.site",
  "streamwish.fun"
];
var DMCA_SERVERS = [
  "hgplaycdn.com",
  "hglamioz.com",
  "niramirus.com",
  "playnixes.com",
  "medixiru.com"
];
var MAIN_SERVERS = [
  "hanerix.com",
  "audinifer.com",
  "vibuxer.com",
  "masukestin.com"
];
var RULES_SERVERS = [
  "dhcplay.com",
  "hglink.to",
  "hgcloud.to"
];
function isStreamWishUrl(url) {
  var str = String(url || "");
  for (var i = 0; i < STREAMWISH_HOSTS.length; i++) {
    if (str.indexOf(STREAMWISH_HOSTS[i]) !== -1)
      return true;
  }
  return false;
}
function extractPath(url) {
  var match = String(url || "").match(/\/(e|d|v)\/([0-9a-zA-Z]+)([^\s"?]*)/);
  if (!match)
    return null;
  return { type: match[1], code: match[2], suffix: match[3] || "" };
}
function pickMirror(url) {
  var str = String(url || "");
  var inRules = false;
  for (var i = 0; i < RULES_SERVERS.length; i++) {
    if (str.indexOf(RULES_SERVERS[i]) !== -1) {
      inRules = true;
      break;
    }
  }
  var servers = inRules ? MAIN_SERVERS : DMCA_SERVERS;
  return servers[Math.floor(Math.random() * servers.length)];
}
function extractM3u8Urls(unpacked) {
  var urls = [];
  var hlsMatches = String(unpacked).match(/"hls[234]"\s*:\s*"([^"]+)"/g);
  if (hlsMatches) {
    for (var i = 0; i < hlsMatches.length; i++) {
      var valMatch = hlsMatches[i].match(/"hls[234]"\s*:\s*"([^"]+)"/);
      if (valMatch && valMatch[1]) {
        var u = valMatch[1];
        if (u.indexOf("http") === 0) {
          urls.push(u);
        }
      }
    }
  }
  if (urls.length === 0) {
    var directMatches = String(unpacked).match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g);
    if (directMatches) {
      urls = directMatches;
    }
  }
  if (urls.length === 0) {
    var fileMatches = String(unpacked).match(/file\s*:\s*"(https?:\/\/[^"]+)"/g);
    if (fileMatches) {
      for (var j = 0; j < fileMatches.length; j++) {
        var fm = fileMatches[j].match(/file\s*:\s*"(https?:\/\/[^"]+)"/);
        if (fm)
          urls.push(fm[1]);
      }
    }
  }
  var seen = {};
  return urls.filter(function(u2) {
    if (seen[u2])
      return false;
    seen[u2] = true;
    return true;
  });
}
function extractQualityFromUnpacked(unpacked) {
  var labelMatch = String(unpacked).match(/label\s*:\s*"([^"]+)"/);
  if (labelMatch)
    return labelMatch[1];
  var heightMatch = String(unpacked).match(/height\s*:\s*(\d+)/);
  if (heightMatch)
    return heightMatch[1] + "p";
  return "";
}
function resolveStreamWish(fetchImpl, embedUrl, refererUrl) {
  var pathInfo = extractPath(embedUrl);
  if (!pathInfo)
    return Promise.resolve([]);
  var code = pathInfo.code;
  var headers = Object.assign({}, BROWSER_HEADERS);
  if (refererUrl)
    headers.Referer = refererUrl;
  function tryResolveFromPage(pageUrl) {
    return fetchText(fetchImpl, pageUrl, { headers }).then(function(html) {
      if (!html)
        return null;
      if (html.indexOf("File is no longer available") !== -1 || html.indexOf("no longer available") !== -1) {
        return null;
      }
      if (html.length < 1e3 && html.indexOf("main.js") !== -1) {
        return "shell";
      }
      if (html.indexOf("eval(function(p,a,c,k,e,") !== -1) {
        var unpacked = unpack(html);
        if (unpacked) {
          var urls = extractM3u8Urls(unpacked);
          if (urls.length > 0) {
            var quality = extractQualityFromUnpacked(unpacked);
            return urls.map(function(u) {
              return {
                url: u,
                quality,
                kind: "hls"
              };
            });
          }
        }
      }
      var directUrls = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g);
      if (directUrls && directUrls.length > 0) {
        return directUrls.map(function(u) {
          return { url: u, quality: "", kind: "hls" };
        });
      }
      return null;
    });
  }
  return tryResolveFromPage(embedUrl).then(function(result) {
    if (result && result !== "shell" && Array.isArray(result)) {
      return result;
    }
    var mirrorHost = pickMirror(embedUrl);
    var mirrorUrl = "https://" + mirrorHost + "/e/" + code;
    return tryResolveFromPage(mirrorUrl).then(function(mirrorResult) {
      if (mirrorResult && mirrorResult !== "shell" && Array.isArray(mirrorResult)) {
        return mirrorResult;
      }
      var allMirrors = DMCA_SERVERS.concat(MAIN_SERVERS);
      function tryNextMirror(index) {
        if (index >= allMirrors.length)
          return Promise.resolve([]);
        if (allMirrors[index] === mirrorHost)
          return tryNextMirror(index + 1);
        var url = "https://" + allMirrors[index] + "/e/" + code;
        return tryResolveFromPage(url).then(function(res) {
          if (res && res !== "shell" && Array.isArray(res))
            return res;
          return tryNextMirror(index + 1);
        });
      }
      return tryNextMirror(0);
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

// src/streamwish-heymovies/index.js
var SITE_BASE = "https://heymovies.cyou";
function buildSearchUrls(request) {
  var queries = [];
  var title = request.title || "";
  queries.push(title.toLowerCase().trim());
  if (request.airYear) {
    queries.push(title + " " + request.airYear);
  }
  var slugs = slugCandidates(title);
  for (var i = 0; i < slugs.length; i++) {
    queries.push(slugs[i].replace(/-/g, " "));
  }
  queries = dedupe(queries);
  var urls = [];
  for (var j = 0; j < queries.length; j++) {
    urls.push(SITE_BASE + "/?s=" + encodeURIComponent(queries[j]));
  }
  return urls;
}
function extractPageUrls(html) {
  var str = String(html || "");
  var results = [];
  var linkRegex = /<a[^>]*href="(https?:\/\/(?:www\.)?heymovies\.(?:cyou|live)\/[^"?#]+\/)"[^>]*rel="bookmark"/gi;
  var matches = str.match(linkRegex) || [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i].match(/href="([^"]+)"/);
    if (m)
      results.push(m[1]);
  }
  if (results.length === 0) {
    var entryRegex = /<a[^>]*class="[^"]*entry-header[^"]*"[^>]*href="(https?:\/\/(?:www\.)?heymovies\.(?:cyou|live)\/[^"?#]+\/)"/gi;
    var entryMatches = str.match(entryRegex) || [];
    for (var e = 0; e < entryMatches.length; e++) {
      var em = entryMatches[e].match(/href="([^"]+)"/);
      if (em)
        results.push(em[1]);
    }
  }
  var filtered = [];
  var seen = {};
  for (var j = 0; j < results.length; j++) {
    var url = results[j].replace("heymovies.live", "heymovies.cyou");
    if (/\/(category|quality|tag|page|author|genre|wp-)\//.test(url))
      continue;
    if (seen[url])
      continue;
    seen[url] = true;
    filtered.push(url);
  }
  return filtered;
}
function extractStreamEndpoint(html) {
  var str = String(html || "");
  var match = str.match(/data-link="(https?:\/\/[^"]*heymovies\.(?:cyou|live)\/stream\?v=\d+)"/i);
  if (match)
    return match[1].replace("heymovies.live", "heymovies.cyou");
  return null;
}
function extractEpisodeStreamEndpoints(html) {
  var str = String(html || "");
  var regex = /data-link="(https?:\/\/[^"]*heymovies\.(?:cyou|live)\/stream\?v=\d+)"/gi;
  var matches = str.match(regex) || [];
  var urls = [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i].match(/data-link="([^"]+)"/);
    if (m) {
      var url = m[1].replace("heymovies.live", "heymovies.cyou");
      if (urls.indexOf(url) === -1)
        urls.push(url);
    }
  }
  return urls;
}
function extractStreamWishEmbeds(html) {
  var str = String(html || "");
  var results = [];
  var regex = /<li[^>]*class="[^"]*linkserver[^"]*"[^>]*data-video="([^"]+)"[^>]*>([^<]*)<\/li>/gi;
  var match;
  while ((match = regex.exec(str)) !== null) {
    var url = match[1];
    var label = match[2].trim();
    if (isStreamWishUrl(url)) {
      results.push({ url, quality: "", label });
    }
  }
  if (results.length === 0) {
    var simpleRegex = /data-video="(https?:\/\/[^"]*(?:streamwish|strwish|wishembed|awish|embedwish|swhoi|hgcloud|hglink|mwish|dwish)[^"]*\/e\/[^"]+)"/gi;
    var simpleMatch;
    while ((simpleMatch = simpleRegex.exec(str)) !== null) {
      results.push({ url: simpleMatch[1], quality: "", label: "" });
    }
  }
  return results;
}
function resolveFromStreamEndpoint(fetchImpl, streamUrl, request) {
  return fetchText(fetchImpl, streamUrl, { headers: BROWSER_HEADERS }).then(function(html) {
    if (!html)
      return [];
    var embeds = extractStreamWishEmbeds(html);
    if (embeds.length === 0)
      return [];
    return Promise.all(
      embeds.map(function(embed) {
        return resolveStreamWish(fetchImpl, embed.url, streamUrl).then(function(streams) {
          return streams.map(function(s) {
            s.sourceTag = "StreamWish";
            return s;
          });
        }).catch(function() {
          return [];
        });
      })
    ).then(function(allStreams) {
      var flat = [];
      for (var i = 0; i < allStreams.length; i++) {
        for (var j = 0; j < allStreams[i].length; j++) {
          flat.push(allStreams[i][j]);
        }
      }
      return dedupeStreams(flat);
    });
  });
}
function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var searchUrls = buildSearchUrls(request);
  return fetchFirstResult(fetchImpl, searchUrls.slice(0, 4), { headers: BROWSER_HEADERS }, function(html) {
    if (!html)
      return null;
    if (html.indexOf("search-no-results") !== -1)
      return null;
    var pageUrls = extractPageUrls(html);
    return pageUrls.length > 0 ? pageUrls : null;
  }).then(function(pageUrls) {
    if (!pageUrls || pageUrls.length === 0)
      return [];
    return fetchFirstResult(fetchImpl, pageUrls.slice(0, 5), { headers: BROWSER_HEADERS }, function(html) {
      if (!html)
        return null;
      if (request.mediaType === "tv" && request.season && request.episode) {
        var epEndpoints = extractEpisodeStreamEndpoints(html);
        var epRegex = /<span[^>]*class="[^"]*episode-button[^"]*"[^>]*data-link="([^"]+)"[^>]*>\s*<i[^>]*><\/i>\s*EP\s*(\d+)/gi;
        var epMatch;
        var epUrls = {};
        while ((epMatch = epRegex.exec(html)) !== null) {
          var epNum = Number(epMatch[2]);
          var epUrl = epMatch[1].replace("heymovies.live", "heymovies.cyou");
          epUrls[epNum] = epUrl;
        }
        if (epUrls[request.episode]) {
          return { type: "stream", url: epUrls[request.episode] };
        }
        var endpoint = extractStreamEndpoint(html);
        if (endpoint)
          return { type: "stream", url: endpoint };
        return null;
      }
      var endpoint2 = extractStreamEndpoint(html);
      if (endpoint2)
        return { type: "stream", url: endpoint2 };
      return null;
    }).then(function(result) {
      if (!result || result.type !== "stream")
        return [];
      return resolveFromStreamEndpoint(fetchImpl, result.url, request);
    });
  }).then(function(resolved) {
    return resolved.map(function(stream) {
      stream.name = "HeyMovies StreamWish";
      if (stream.sourceTag) {
        stream.name += " (" + stream.sourceTag + ")";
      }
      return toNuvioStream(request, stream);
    });
  }).catch(function(error) {
    console.log("[StreamWish HeyMovies] getStreams failed: " + error.message);
    return [];
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "movie" && mediaType !== "tv") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, {}).then(function(request) {
    return getStreamsForRequest(request, { fetchImpl: typeof fetch !== "undefined" ? fetch : null });
  }).catch(function(error) {
    console.log("[StreamWish HeyMovies] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
