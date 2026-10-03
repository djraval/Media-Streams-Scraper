// TellyNagari.com Nuvio provider — resolves Indian TV episodes from
// tellynagari.com through its tellyduniya click-gate.
//
// The "click-gate" is ad dressing only: posts carry
//   <a ... onClick=itm('https://www.tellyduniya.com/usn/{gate}.php?docid={id}')>
//   Watch Online ({LABEL})</a>
// and {gate}+{docid} map DIRECTLY onto articleweb.xyz/vid/{path}.php?id={docid}:
//   girmeet ("GOF")    -> gdrive.php   -> <source src="...yandex hls master-playlist.m3u8">
//   kratike ("VKSpeed")-> vkspeed.php  -> wraps vkspeed.com/embed-{docid}.html
// tellyduniya itself is a dead-end ad chain (premiumfree -> repeattelecast)
// and is never fetched. Unknown gate names probe gdrive.php then vkspeed.php.
//
// Post slugs: /2026/{show}-{ordinal}-{month}-{year}/

import { TMDB_API_KEY, BROWSER_HEADERS } from "../lib/constants.js";
import { resolveFetch, fetchFirstResult, fetchContentLength } from "../lib/http.js";
import { dedupe, dedupeStreams, isPlaceholderUrl, links } from "../lib/html.js";
import { buildMediaRequest } from "../lib/tmdb.js";
import { episodePostCandidates, slugTimestamp } from "../lib/episodes.js";
import { resolveVkPlayer } from "../lib/vkplayer.js";
import { toNuvioStream, formatBytes } from "../lib/format.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://tellynagari.com";
var SEARCH_PATH = "/?s=";
var SITE_HOST_RE = /^https:\/\/(?:www\.)?tellynagari\.com\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$|\/(about|contact|dmca|privacy|terms)/i;
var ARTICLEWEB = "https://articleweb.xyz/vid/";
// Known tellyduniya gate -> articleweb path names.
var GATE_MAP = {
  girmeet: "gdrive",
  kratike: "vkspeed",
};
// Fallback probe order for unknown gate names.
var GATE_PROBES = ["gdrive", "vkspeed"];
var YANDEX_RE = /(https?:\/\/streaming\.disk\.yandex\.net\/hls\/[^"'\s<>]+m3u8[^"'\s<>]*)/i;
var GENERIC_M3U8_RE = /(https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*)/i;
var VK_EMBED_RE = /(vkspeed\.com|vkprime\.com)\/embed-[A-Za-z0-9_-]+(?:-\d+x\d+)?\.html/i;

function displayBackend(backend) {
  return String(backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, function (_m, prefix, ch) { return prefix + ch.toUpperCase(); })
    .replace(/[-_]+/g, "");
}

// ---------------------------------------------------------------------------
// Layer 2: Episode page discovery
// ---------------------------------------------------------------------------

function buildSearchUrls(request) {
  return (request.slugCandidates || []).slice(0, 3).map(function (slug) {
    return SITE_BASE + SEARCH_PATH + encodeURIComponent(slug.replace(/-/g, " ")).replace(/%20/g, "+");
  });
}

// Tellynagari keeps only the LATEST episode post per show, so date/position
// matching misses anything but the newest. When strict matching finds nothing
// and the show has exactly one dated post, accept it only when TMDB lacks the
// air date (episodes with a known date would be mismatched) and the post is
// fresh — the site semantically serves "latest episode" only.
var LATEST_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

function episodePageCandidates(markup, request) {
  var hrefs = links(markup);
  var strict = episodePostCandidates(hrefs, request, SITE_HOST_RE, NON_POST_RE);
  if (strict.length > 0) return strict;
  if (request.airDate) return [];
  var dated = dedupe(hrefs.filter(function (href) {
    return SITE_HOST_RE.test(href) && !NON_POST_RE.test(href) &&
      slugTimestamp(href) > 0 &&
      (request.slugCandidates || []).some(function (slug) {
        return href.toLowerCase().indexOf(slug) !== -1;
      });
  }));
  if (dated.length !== 1) return [];
  var ts = slugTimestamp(dated[0]);
  if (Math.abs(Date.now() - ts) > LATEST_WINDOW_MS) return [];
  return dated;
}

// ---------------------------------------------------------------------------
// Layer 3: Gate links -> articleweb player pages
// ---------------------------------------------------------------------------

// Each post has <a ... onClick=itm('https://www.tellyduniya.com/usn/{gate}.php?docid={id}')>LABEL</a>
function findGateLinks(markup) {
  var gates = [];
  var re = /<a\b[^>]*itm\('([^']+)'\)[^>]*>([^<]*)<\/a>/gi;
  var m;
  while ((m = re.exec(markup)) !== null) {
    var gateMatch = m[1].match(/\/usn\/([A-Za-z0-9_-]+)\.php\?.*docid=([A-Za-z0-9_-]+)/i);
    if (!gateMatch) continue;
    var labelMatch = m[2].match(/\(([^)]+)\)/);
    gates.push({
      gate: gateMatch[1],
      docid: gateMatch[2],
      label: labelMatch ? labelMatch[1] : gateMatch[1],
    });
  }
  var seen = {};
  return gates.filter(function (g) {
    var key = g.gate + "|" + g.docid;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function findGatesFromPages(fetchImpl, urls) {
  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (page) {
    var gates = findGateLinks(page);
    return gates.length > 0 ? { gates: gates, pageUrl: urls[0] } : null;
  }).then(function (hit) {
    return hit ? hit.gates : [];
  });
}

// ---------------------------------------------------------------------------
// Layer 4: articleweb resolution
// ---------------------------------------------------------------------------

function candidatePaths(gate) {
  var paths = [];
  if (GATE_MAP[gate]) paths.push(GATE_MAP[gate]);
  GATE_PROBES.forEach(function (p) {
    if (paths.indexOf(p) === -1) paths.push(p);
  });
  return paths;
}

// Fetch /vid/{path}.php?id={docid} pages until one yields a playable marker:
// a yandex HLS <source> or a vkspeed embed reference.
function resolveGate(fetchImpl, gate, docid, referer) {
  var paths = candidatePaths(gate);
  var idx = 0;
  function tryNext() {
    if (idx >= paths.length) return Promise.resolve(null);
    var pageUrl = ARTICLEWEB + paths[idx] + ".php?id=" + encodeURIComponent(docid);
    idx += 1;
    return fetchImpl(pageUrl, { headers: { Referer: referer, "User-Agent": BROWSER_HEADERS["User-Agent"] } })
      .then(function (res) { return res ? res.text() : null; })
      .then(function (page) {
        if (!page) return tryNext();
        var yx = page.match(YANDEX_RE) || page.match(GENERIC_M3U8_RE);
        if (yx) {
          return { kind: "hls", backend: "yandex", url: yx[1] };
        }
        var vk = page.match(VK_EMBED_RE);
        if (vk) {
          return { kind: "vk", backend: "vkspeed", url: "https://" + vk[0] };
        }
        return tryNext();
      })
      .catch(function () { return tryNext(); });
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
      headers: null,
    });
  }
  // vkspeed embed -> MP4 sources via the shared resolver
  return resolveVkPlayer(resolved.url, referer, { fetchImpl: fetchImpl })
    .then(function (sources) {
      var real = (sources || []).filter(function (s) { return !isPlaceholderUrl(s.url); });
      if (real.length === 0) return null;
      var best = real[0];
      var stream = {
        backend: resolved.backend,
        kind: "mp4",
        quality: best.quality || "unknown",
        url: best.url,
        size: "",
        sizeBytes: 0,
        sourceTag: label,
        headers: best.headers,
      };
      return fetchContentLength(fetchImpl, best.url, best.headers).then(function (sizeBytes) {
        stream.size = formatBytes(sizeBytes);
        stream.sizeBytes = sizeBytes;
        return stream;
      });
    });
}

function resolveGates(fetchImpl, gates, referer) {
  return Promise.all(gates.map(function (g) {
    return resolveGate(fetchImpl, g.gate, g.docid, referer)
      .then(function (resolved) {
        if (!resolved) return null;
        return toStream(fetchImpl, resolved, g.label, referer);
      })
      .catch(function (error) {
        console.log("[TellyNagari] gate " + g.gate + " failed: " + (error && error.message));
        return null;
      });
  })).then(function (streams) {
    return streams.filter(function (s) { return s !== null; });
  });
}

// ---------------------------------------------------------------------------
// Layer 5 + Layer 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function resolveTellyNagari(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return fetchFirstResult(fetchImpl, buildSearchUrls(request), { headers: BROWSER_HEADERS }, function (page) {
    var episodeUrls = episodePageCandidates(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function (episodeUrls) {
    if (!episodeUrls) return [];
    return findGatesFromPages(fetchImpl, episodeUrls).then(function (gates) {
      return resolveGates(fetchImpl, gates.slice(0, 6), episodeUrls[0] || SITE_BASE + "/");
    });
  });
}

function getStreamsForRequest(request, options) {
  return resolveTellyNagari(request, options)
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "TellyNagari " + displayBackend(stream.backend) + (stream.sourceTag ? " (" + stream.sourceTag + ")" : "");
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[TellyNagari] resolver failed: " + error.message);
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
      console.log("[TellyNagari] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
