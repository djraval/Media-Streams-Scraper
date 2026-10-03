// DesiTvBox.sbs Nuvio provider — resolves Indian TV episodes from
// desitvbox.sbs via VkSpeed (MP4) embeds and the site's own jw/mobi/fluid
// player pages, which expose a plaintext Yandex Disk HLS master playlist.
//
// Post slugs: {show}-{ordinalDay}-{month}-{year}-video-episode-update-online
// Search:     /search/{space separated terms}/ (path-style, not ?s=)

import { TMDB_API_KEY, BROWSER_HEADERS, VKSPEED_HOSTS, VKPRIME_HOSTS } from "../lib/constants.js";
import { resolveFetch, fetchFirstResult, fetchContentLength } from "../lib/http.js";
import { dedupe, dedupeStreams, isPlaceholderUrl, embedHostRegex, links, iframeSrcCandidates, resolveRelativeUrl } from "../lib/html.js";
import { buildMediaRequest, episodeDateSlug } from "../lib/tmdb.js";
import { episodePostCandidates } from "../lib/episodes.js";
import { resolveVkPlayer } from "../lib/vkplayer.js";
import { toNuvioStream, formatBytes } from "../lib/format.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://desitvbox.sbs";
var SITE_HOST_RE = /^https:\/\/(?:www\.)?desitvbox\.sbs\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$/i;
var VKPRIME_RE = embedHostRegex(VKPRIME_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
var VKSPEED_RE = embedHostRegex(VKSPEED_HOSTS, "embed-[A-Za-z0-9-]+\\.html");
// Local player wrappers that render a plaintext HLS/MP4 URL in page source.
var LOCAL_PLAYER_RE = /\/(?:jwplayer|mobiplayer|player)\.php\?id=[A-Za-z0-9_-]+/gi;
var STREAM_URL_RE = /(?:streamUrl|file|source|src)\s*[=:]\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i;

function displayBackend(backend) {
  return String(backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, function (_match, prefix, ch) { return prefix + ch.toUpperCase(); })
    .replace(/[-_]+/g, "");
}

// ---------------------------------------------------------------------------
// Layer 2: Episode page discovery
// ---------------------------------------------------------------------------

function siteSlugCandidates(request) {
  var candidates = request.slugCandidates || [];
  return dedupe(candidates.map(function (slug) {
    return slug.replace(/-s(?=-|$)/g, "s");
  }).concat(candidates));
}

function buildEpisodeUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) return [];
  return siteSlugCandidates(request).map(function (slug) {
    return SITE_BASE + "/" + slug + "-" + dateSlug + "-video-episode-update-online/";
  });
}

function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  var terms = function (slug) { return slug.replace(/-/g, "+"); };
  var urls = siteSlugCandidates(request).slice(0, 2).map(function (slug) {
    return SITE_BASE + "/search/" + terms(slug) + "/";
  });
  if (dateSlug) {
    var dateQuery = dateSlug.replace(/-/g, "+");
    urls = siteSlugCandidates(request).slice(0, 2).map(function (slug) {
      return SITE_BASE + "/search/" + terms(slug) + "+" + dateQuery + "/";
    }).concat(urls);
  }
  return dedupe(urls);
}

function episodePageCandidates(markup, request) {
  return episodePostCandidates(links(markup), request, SITE_HOST_RE, NON_POST_RE);
}

// ---------------------------------------------------------------------------
// Layer 3: Embed extraction (vk iframes + local player pages)
// ---------------------------------------------------------------------------

function findEmbedCandidates(markup) {
  var vk = iframeSrcCandidates(markup).map(function (href) {
    // desitvbox uses protocol-relative "//vkspeed.com/embed-..." src values.
    return resolveRelativeUrl(SITE_BASE + "/", href);
  }).filter(function (href) {
    return VKPRIME_RE.test(href) || VKSPEED_RE.test(href);
  });
  var local = (String(markup).match(LOCAL_PLAYER_RE) || []).map(function (path) {
    return SITE_BASE + path;
  });
  return { vk: dedupe(vk), local: dedupe(local) };
}

function findEmbedsFromPages(fetchImpl, urls) {
  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (page) {
    var found = findEmbedCandidates(page);
    return (found.vk.length > 0 || found.local.length > 0) ? found : null;
  });
}

// ---------------------------------------------------------------------------
// Layer 4: Resolution
// ---------------------------------------------------------------------------

function resolveVkEmbeds(fetchImpl, iframeUrls) {
  return Promise.all(iframeUrls.map(function (iframeUrl) {
    var backend = iframeUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
    return resolveVkPlayer(iframeUrl, SITE_BASE + "/", { fetchImpl: fetchImpl })
      .then(function (sources) {
        var real = (sources || []).filter(function (source) {
          return !isPlaceholderUrl(source.url);
        });
        if (real.length === 0) return null;
        var best = real[0];
        var stream = {
          backend: backend,
          kind: "mp4",
          quality: best.quality || "unknown",
          url: best.url,
          size: "",
          sizeBytes: 0,
          sourceTag: "",
          headers: best.headers,
        };
        return fetchContentLength(fetchImpl, best.url, best.headers).then(function (sizeBytes) {
          stream.size = formatBytes(sizeBytes);
          stream.sizeBytes = sizeBytes;
          return stream;
        });
      })
      .catch(function (error) {
        console.log("[DesiTvBox.sbs] vk resolution failed for " + iframeUrl + ": " + (error && error.message));
        return null;
      });
  }));
}

function resolveLocalPlayers(fetchImpl, playerUrls) {
  return Promise.all(playerUrls.map(function (playerUrl) {
    return fetchImpl(playerUrl, { headers: { Referer: SITE_BASE + "/", "User-Agent": BROWSER_HEADERS["User-Agent"] } })
      .then(function (res) {
        // player.php can 403 yet still embed the stream URL in its body —
        // extract from whatever page is returned rather than gating on res.ok.
        if (!res) return null;
        return res.text();
      })
      .then(function (page) {
        if (!page) return null;
        var match = page.match(STREAM_URL_RE) ||
          page.match(/["'](https?:\/\/[^"']+m3u8[^"']*)["']/i) ||
          page.match(/["'](https?:\/\/[^"']+mp4[^"']*)["']/i);
        if (!match) return null;
        var url = match[1];
        var skin = playerUrl.indexOf("mobiplayer") !== -1 ? "Plyr"
          : playerUrl.indexOf("player") !== -1 && playerUrl.indexOf("jwplayer") === -1 ? "Fluid"
          : "JW";
        return {
          backend: "yandex-" + skin.toLowerCase(),
          kind: url.indexOf(".mp4") !== -1 ? "mp4" : "hls",
          quality: "",
          url: url,
          size: "",
          sizeBytes: 0,
          sourceTag: skin + " skin",
          headers: { "User-Agent": BROWSER_HEADERS["User-Agent"], "Referer": SITE_BASE + "/" },
        };
      })
      .catch(function (error) {
        console.log("[DesiTvBox.sbs] local player failed for " + playerUrl + ": " + (error && error.message));
        return null;
      });
  }));
}

function resolveEmbeds(fetchImpl, found) {
  return Promise.all([
    resolveVkEmbeds(fetchImpl, found.vk),
    resolveLocalPlayers(fetchImpl, found.local),
  ]).then(function (groups) {
    return dedupeStreams(groups[0].concat(groups[1]));
  });
}

function resolveDesiTvBox(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return findEmbedsFromPages(fetchImpl, buildEpisodeUrls(request))
    .then(function (found) {
      if (found) return resolveEmbeds(fetchImpl, found);
      return fetchFirstResult(fetchImpl, buildSearchUrls(request), { headers: BROWSER_HEADERS }, function (page) {
        var episodeUrls = episodePageCandidates(page, request);
        return episodeUrls.length > 0 ? episodeUrls : null;
      }).then(function (episodeUrls) {
        if (!episodeUrls) return [];
        return findEmbedsFromPages(fetchImpl, episodeUrls).then(function (searchFound) {
          return searchFound ? resolveEmbeds(fetchImpl, searchFound) : [];
        });
      });
    });
}

// ---------------------------------------------------------------------------
// Layer 5 + Layer 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  return resolveDesiTvBox(request, options)
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "DesiTvBox.sbs " + displayBackend(stream.backend);
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[DesiTvBox.sbs] resolver failed: " + error.message);
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") return Promise.resolve([]);
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[DesiTvBox.sbs] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
