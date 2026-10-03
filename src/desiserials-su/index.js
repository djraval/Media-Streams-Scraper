// DesiSerials.su Nuvio provider — resolves Indian TV episodes from
// desiserials.su through the searchping/showdetails chain.
//
// Posts list "Watch Now" links to
//   go.searchping.com/desiserials/getlink.php?v={t1}&part2={t2}&part3={t3}&type={player}
// The getlink → showdetails doorway → player chain is pure ad dressing. The
// tokens ARE the payload: each part token fetches
//   dstshndisk.showdetails.org/hls/media_meta.php?v={token}&type=player
// which returns JSON {source:{file:"play.php?v=...&exp&sig",fallbackFile:
// "proxy.php?...",title:"Part N Show Date"}} — signed MP4 URLs, ~1h expiry.
// v → Part 1, part2 → Part 2, part3 → Part 3.
//
// Discovery: /category/{show-slug}/ lists dated posts
// /{show}-{ordinal}-{month}-{year}-full-episode-{channel}/{hashid}/
// (site ?s= returns latest posts only — not a real search).

import { TMDB_API_KEY, BROWSER_HEADERS } from "../lib/constants.js";
import { resolveFetch, fetchFirstResult, fetchJson } from "../lib/http.js";
import { dedupe, dedupeStreams, links } from "../lib/html.js";
import { buildMediaRequest } from "../lib/tmdb.js";
import { episodePostCandidates } from "../lib/episodes.js";
import { toNuvioStream } from "../lib/format.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://www.desiserials.su";
var META_BASE = "https://dstshndisk.showdetails.org/hls/";
// Post links are root-relative.
var POST_RE = /^\/[a-z0-9-]+-(?:1st|2nd|3rd|\d+th)-[a-z]+-\d{4}-full-episode-[a-z-]+\/[a-f0-9]{14,}\/?$/i;
var GETLINK_RE = /getlink\.php\?([^"'&\s]+(?:&[^"'\s]*)?)/i;

// ---------------------------------------------------------------------------
// Layer 2: Episode page discovery — per-show category pages
// ---------------------------------------------------------------------------

function categoryUrls(request) {
  return (request.slugCandidates || []).slice(0, 4).map(function (slug) {
    return SITE_BASE + "/category/" + slug + "/";
  });
}

function episodePageCandidates(markup, request) {
  var hrefs = links(markup).map(function (href) {
    if (href.indexOf("http") !== 0 && href.charAt(0) === "/") {
      return SITE_BASE + href;
    }
    return href;
  });
  var hostRe = /^https:\/\/(?:www\.)?desiserials\.su\//i;
  var candidates = episodePostCandidates(hrefs, request, hostRe, null);
  // The generic matcher doesn't know the "/{hash}/" suffix shape; posts also
  // carry a "-full-episode-{channel}" tail before the hash id.
  if (candidates.length === 0) {
    var slugVariants = (request.slugCandidates || []).map(function (s) { return s.toLowerCase(); });
    candidates = dedupe(hrefs.filter(function (href) {
      var path = href.replace(hostRe, "/");
      if (!POST_RE.test(path)) return false;
      var lower = href.toLowerCase();
      return slugVariants.some(function (slug) { return lower.indexOf(slug) !== -1; });
    }));
    // Prefer the post whose slug date matches the requested air date;
    // otherwise the newest dated post (site keeps ~2 weeks of history).
    if (request.airDate) {
      var wanted = request.airDate.toLowerCase();
      var dm = wanted.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dm) {
        var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
        var ord = Number(dm[3]) + ({ 1: "st", 2: "nd", 3: "rd" }[Number(dm[3]) % 10] || "th") + "-" + MONTHS[Number(dm[2]) - 1] + "-" + dm[1];
        var exact = candidates.filter(function (h) { return h.toLowerCase().indexOf(ord) !== -1; });
        if (exact.length > 0) return exact;
      }
      return [];
    }
    // No air date: newest post (slugs sort chronologically by date string —
    // not reliable across months, so pick by slug timestamp via regex).
    var ts = candidates.map(function (h) {
      var m = h.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)-([a-z]+)-(\d{4})/);
      return m ? Date.UTC(Number(m[3]), MONTH_IDX[m[2]] !== undefined ? MONTH_IDX[m[2]] : 0, Number(m[1])) : 0;
    });
    var best = 0;
    for (var i = 1; i < ts.length; i++) { if (ts[i] > ts[best]) best = i; }
    return ts[best] ? [candidates[best]] : [];
  }
  return candidates;
}

var MONTH_IDX = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// ---------------------------------------------------------------------------
// Layer 3: getlink tokens -> media_meta
// ---------------------------------------------------------------------------

// First getlink URL's query: v / part2 / part3 / type — all parts of one video.
function extractPartTokens(markup) {
  var m = markup.match(GETLINK_RE);
  if (!m) return [];
  var query = m[1].replace(/&amp;/g, "&");
  var params = {};
  query.split("&").forEach(function (kv) {
    var eq = kv.indexOf("=");
    if (eq > 0) params[kv.slice(0, eq)] = kv.slice(eq + 1);
  });
  var tokens = [];
  ["v", "part2", "part3", "part4"].forEach(function (key, i) {
    if (params[key]) tokens.push({ part: i + 1, token: params[key] });
  });
  return tokens;
}

function resolvePart(fetchImpl, token) {
  var metaUrl = META_BASE + "media_meta.php?v=" + encodeURIComponent(token) + "&type=player";
  return fetchJson(fetchImpl, metaUrl, { headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] } })
    .then(function (meta) {
      if (!meta || !meta.source || !meta.source.file) return null;
      var file = meta.source.file;
      var fallback = meta.source.fallbackFile;
      var abs = function (u) { return u && u.charAt(0) !== "h" ? META_BASE + u : u; };
      return {
        title: meta.source.title || "",
        file: abs(file),
        fallback: abs(fallback),
        mimeType: meta.source.mimeType || "video/mp4",
      };
    })
    .catch(function () { return null; });
}

// ---------------------------------------------------------------------------
// Layer 4 + 5: Resolution + entry point
// ---------------------------------------------------------------------------

function resolveDesiSerials(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return fetchFirstResult(fetchImpl, categoryUrls(request), { headers: BROWSER_HEADERS }, function (page) {
    var episodeUrls = episodePageCandidates(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function (episodeUrls) {
    if (!episodeUrls) return [];
    return fetchFirstResult(fetchImpl, episodeUrls.slice(0, 2), { headers: BROWSER_HEADERS }, function (page) {
      var tokens = extractPartTokens(page);
      return tokens.length > 0 ? tokens : null;
    }).then(function (tokens) {
      if (!tokens) return [];
      return Promise.all(tokens.map(function (t) {
        return resolvePart(fetchImpl, t.token).then(function (meta) {
          if (!meta) return null;
          return {
            backend: "dstshndisk",
            kind: "mp4",
            quality: "480p",
            url: meta.file,
            fallbackUrl: meta.fallback,
            size: "",
            sizeBytes: 0,
            sourceTag: meta.title.replace(/\s*\d{1,2}(?:st|nd|rd|th)\s+\w+\s+\d{4}\s*$/i, "").trim() || ("Part " + t.part),
            headers: null,
          };
        });
      })).then(function (streams) {
        return streams.filter(function (s) { return s !== null; });
      });
    });
  });
}

function getStreamsForRequest(request, options) {
  return resolveDesiSerials(request, options)
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "DesiSerials " + (stream.sourceTag ? "(" + stream.sourceTag + ")" : "");
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[DesiSerials] resolver failed: " + error.message);
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
      console.log("[DesiSerials] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
