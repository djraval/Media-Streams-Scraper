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

// src/lib/filemoon.js
var FILEMOON_HOSTS = [
  "filemoon.to",
  "filemoon.sx",
  "filemoon.in",
  "filemoon.link",
  "filemoon.nl",
  "filemoon.wf",
  "cinegrab.com",
  "filemoon.eu",
  "filemoon.art",
  "moonmov.pro"
];
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
function concatBytes(a, b) {
  var result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}
function extractFileMoonCode(url) {
  var str = String(url || "");
  for (var i = 0; i < FILEMOON_HOSTS.length; i++) {
    var host = FILEMOON_HOSTS[i];
    if (str.indexOf(host) !== -1) {
      var match = str.match(new RegExp("(?:/e/|/d/)([0-9a-zA-Z]+)"));
      if (match)
        return match[1];
    }
  }
  var codeMatch = str.match(/\/(?:e|d)\/([0-9a-zA-Z]{10,})/);
  return codeMatch ? codeMatch[1] : null;
}
function decryptPlayback(playback) {
  var version = Number(playback.version);
  var keyParts = playback.key_parts || [];
  var idx1 = version - 1;
  var idx2 = 30 - version;
  if (idx1 < 0 || idx1 >= keyParts.length || idx2 < 0 || idx2 >= keyParts.length) {
    return Promise.reject(new Error("FileMoon: invalid key indices"));
  }
  var keyPart1 = base64UrlToBytes(keyParts[idx1]);
  var keyPart2 = base64UrlToBytes(keyParts[idx2]);
  var keyBytes = concatBytes(keyPart1, keyPart2);
  if (keyBytes.length !== 32) {
    return Promise.reject(new Error("FileMoon: key length " + keyBytes.length + ", expected 32"));
  }
  var ivBytes = base64UrlToBytes(playback.iv);
  var payloadBytes = base64UrlToBytes(playback.payload);
  var subtle = typeof crypto !== "undefined" && crypto.subtle || typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    return Promise.reject(new Error("FileMoon: crypto.subtle not available"));
  }
  return subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]).then(function(key) {
    return subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, payloadBytes);
  }).then(function(decrypted) {
    var json = bytesToString(new Uint8Array(decrypted));
    return JSON.parse(json);
  });
}
function resolveFileMoon(fetchImpl, embedUrl, refererUrl) {
  var code = extractFileMoonCode(embedUrl);
  if (!code)
    return Promise.resolve([]);
  var apiHost = "filemoon.to";
  for (var i = 0; i < FILEMOON_HOSTS.length; i++) {
    if (String(embedUrl).indexOf(FILEMOON_HOSTS[i]) !== -1) {
      apiHost = FILEMOON_HOSTS[i];
      break;
    }
  }
  var apiUrl = "https://" + apiHost + "/api/videos/" + code;
  var headers = Object.assign({}, BROWSER_HEADERS);
  if (refererUrl)
    headers.Referer = refererUrl;
  return fetchImpl(apiUrl, { headers }).then(function(response) {
    if (!response || response.ok === false)
      return null;
    return response.json();
  }).then(function(data) {
    if (!data || !data.playback)
      return [];
    return decryptPlayback(data.playback).then(function(decrypted) {
      var sources = (decrypted.sources || []).filter(function(s) {
        return s.url && s.mime_type === "application/vnd.apple.mpegurl";
      });
      return sources.map(function(s) {
        return {
          url: s.url,
          quality: s.label || (s.height ? s.height + "p" : ""),
          label: s.label || "",
          height: s.height || 0,
          bitrate: s.bitrate_kbps ? s.bitrate_kbps * 1e3 : 0,
          sizeBytes: s.size_bytes || 0,
          kind: "hls"
        };
      });
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

// src/filemoon-movieswatch/index.js
var SITE_BASE = "https://www.movieswatchhd.com";
function buildSearchUrls(request) {
  var slugs = slugCandidates(request.title);
  var queries = [];
  queries.push(request.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  for (var i = 0; i < slugs.length; i++) {
    queries.push(slugs[i].replace(/-/g, " "));
  }
  if (request.airYear) {
    queries.push(request.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " " + request.airYear);
  }
  queries = dedupe(queries);
  var urls = [];
  for (var j = 0; j < queries.length; j++) {
    urls.push(SITE_BASE + "/search?search=" + encodeURIComponent(queries[j]));
  }
  return urls;
}
function extractWatchPageUrls(html) {
  var urlRegex = /href="(https?:\/\/(?:www\.)?movieswatchhd\.com\/watch-video\/\d+)"/gi;
  var matches = String(html || "").match(urlRegex) || [];
  var urls = [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i].match(/href="([^"]+)"/);
    if (m)
      urls.push(m[1]);
  }
  return dedupe(urls);
}
function extractMovieTitle(html) {
  var h1Match = String(html || "").match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) {
    var title = h1Match[1].replace(/^Watch\s+/i, "").replace(/\s+Stream\s+Online.*$/i, "").replace(/\s+Free\s+Download.*$/i, "").trim();
    return title;
  }
  var titleMatch = String(html || "").match(/<title>[^<]*Watch\s+([^<]+?)\s+(?:Hindi|Stream|Online|Free|Download|HD)/i);
  if (titleMatch)
    return titleMatch[1].trim();
  return "";
}
function titleMatches(pageTitle, requestTitle) {
  var p = pageTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
  var r = requestTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!p || !r)
    return false;
  if (p === r)
    return true;
  if (p.indexOf(r) !== -1 || r.indexOf(p) !== -1)
    return true;
  return false;
}
function extractFileMoonEmbeds(html) {
  var results = [];
  var str = String(html || "");
  var iframeRegex = /<iframe[^>]*src="(https?:\/\/[^"]*filemoon\.[a-z]+\/e\/[0-9a-zA-Z]+)"/gi;
  var iframeMatches = str.match(iframeRegex) || [];
  for (var i = 0; i < iframeMatches.length; i++) {
    var m = iframeMatches[i].match(/src="([^"]+)"/);
    if (m) {
      results.push({ url: m[1], quality: "" });
    }
  }
  var sourceRegex = /<source[^>]*src="(https?:\/\/[^"]*filemoon\.[a-z]+\/e\/[0-9a-zA-Z]+)"/gi;
  var sourceMatches = str.match(sourceRegex) || [];
  for (var j = 0; j < sourceMatches.length; j++) {
    var sm = sourceMatches[j].match(/src="([^"]+)"/);
    if (sm) {
      results.push({ url: sm[1], quality: "" });
    }
  }
  var downloadRegex = /Quality:\s*Filemoon\s*(\d+)/gi;
  var lastIndex = 0;
  var dm;
  while ((dm = downloadRegex.exec(str)) !== null) {
    var quality = dm[1] + "p";
    var afterLabel = str.substring(dm.index);
    var linkMatch = afterLabel.match(/href="(https?:\/\/[^"]*filemoon\.[a-z]+\/d\/[0-9a-zA-Z]+)"/i);
    if (linkMatch) {
      var embedUrl = linkMatch[1].replace(/\/d\//, "/e/");
      results.push({ url: embedUrl, quality });
    }
  }
  var seen = {};
  var deduped = [];
  for (var k = 0; k < results.length; k++) {
    var key = results[k].url;
    if (seen[key]) {
      if (!seen[key].quality && results[k].quality) {
        seen[key].quality = results[k].quality;
      }
    } else {
      seen[key] = results[k];
      deduped.push(results[k]);
    }
  }
  return deduped;
}
function resolveFromFileMoonPages(fetchImpl, watchUrls, request) {
  if (watchUrls.length === 0)
    return Promise.resolve([]);
  return fetchFirstResult(fetchImpl, watchUrls.slice(0, 5), { headers: BROWSER_HEADERS }, function(html) {
    if (!html)
      return null;
    var pageTitle = extractMovieTitle(html);
    if (pageTitle && request.title && !titleMatches(pageTitle, request.title)) {
      return null;
    }
    var embeds = extractFileMoonEmbeds(html);
    if (embeds.length === 0)
      return null;
    return embeds;
  }).then(function(embeds) {
    if (!embeds || embeds.length === 0)
      return [];
    return Promise.all(
      embeds.map(function(embed) {
        return resolveFileMoon(fetchImpl, embed.url, SITE_BASE).then(function(streams) {
          return streams.map(function(s) {
            if (!s.quality && embed.quality) {
              s.quality = embed.quality;
            }
            s.sourceTag = "FileMoon";
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
  if (request.mediaType !== "movie") {
    return Promise.resolve([]);
  }
  var searchUrls = buildSearchUrls(request);
  return fetchFirstResult(fetchImpl, searchUrls.slice(0, 4), { headers: BROWSER_HEADERS }, function(html) {
    if (!html)
      return null;
    var watchUrls = extractWatchPageUrls(html);
    return watchUrls.length > 0 ? watchUrls : null;
  }).then(function(watchUrls) {
    if (!watchUrls || watchUrls.length === 0)
      return [];
    return resolveFromFileMoonPages(fetchImpl, watchUrls, request);
  }).then(function(resolved) {
    return resolved.map(function(stream) {
      stream.name = "MoviesWatchHD FileMoon";
      if (stream.sourceTag) {
        stream.name += " (" + stream.sourceTag + ")";
      }
      return toNuvioStream(request, stream);
    });
  }).catch(function(error) {
    console.log("[FileMoon MoviesWatchHD] getStreams failed: " + error.message);
    return [];
  });
}
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "movie") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, {}).then(function(request) {
    return getStreamsForRequest(request, { fetchImpl: typeof fetch !== "undefined" ? fetch : null });
  }).catch(function(error) {
    console.log("[FileMoon MoviesWatchHD] getStreams failed: " + error.message);
    return [];
  });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
