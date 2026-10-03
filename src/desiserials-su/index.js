// DesiSerials.su Nuvio provider — resolves Indian TV episodes from
// desiserials.su through the searchping/showdetails chain.
//
// Posts list "Watch Now" links to
//   go.searchping.com/desiserials/getlink.php?v={t1}&part2={t2}&part3={t3}&type={player}
// The getlink → showdetails doorway → player chain is pure ad dressing. The
// tokens ARE the payload: each part token resolves via
//   dstshndisk.showdetails.org/hls/media_meta.php?v={token}&type=player
// to JSON {source:{file:"play.php?v=...&exp&sig",fallbackFile:"proxy.php?...",
// title:"Part N Show Date"}} — signed MP4s, ~1h expiry.
//
// Discovery: /category/{show-slug}/ lists dated posts
// /{show}-{ordinal}-{month}-{year}-full-episode-{channel}/{hashid}/
// (site ?s= returns latest posts only — not a real search).
//
// Extraction/resolution live in src/lib/chain.js — this file is config only.

import { chainProvider } from "../lib/chain.js";
import { dedupe, links } from "../lib/html.js";

var SITE_HOST_RE = /^https:\/\/(?:www\.)?desiserials\.su\//i;
// Post links are root-relative paths ending in a hex hash id.
var POST_RE = /^\/[a-z0-9-]+-(?:1st|2nd|3rd|\d+th)-[a-z]+-\d{4}-full-episode-[a-z-]+\/[a-f0-9]{14,}\/?$/i;
var GETLINK_RE = /getlink\.php\?/i;
var META_BASE = "https://dstshndisk.showdetails.org/hls/";

var MONTH_IDX = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

var provider = chainProvider({
  name: "DesiSerials",
  siteBase: "https://www.desiserials.su",
  mediaTypes: ["tv"],

  // getlink.php?v={t1}&part2={t2}&part3={t3}&type=... → one media_meta URL
  // per part token. The getlink URL itself is never fetched.
  transforms: [
    {
      match: GETLINK_RE,
      expand: function (_m, url) {
        var query = url.slice(url.indexOf("?") + 1);
        var params = {};
        query.split("&").forEach(function (kv) {
          var eq = kv.indexOf("=");
          if (eq > 0) params[kv.slice(0, eq)] = kv.slice(eq + 1);
        });
        return ["v", "part2", "part3", "part4"]
          .filter(function (key) { return params[key]; })
          .map(function (key) {
            return META_BASE + "media_meta.php?v=" + encodeURIComponent(params[key]) + "&type=player";
          });
      },
    },
  ],

  // ?s= on this site returns the latest posts, not a real search — the
  // per-show category page is the real listing.
  searchUrls: function (_request, slugs) {
    return slugs.slice(0, 4).map(function (slug) {
      return "https://www.desiserials.su/category/" + slug + "/";
    });
  },

  // Category listings link to posts shaped as
  // /{show}-{ordinal}-{month}-{year}-full-episode-{channel}/{hashid}/ —
  // match by shape + slug, then prefer the post whose slug date matches the
  // requested air date (else newest dated post).
  postCandidates: function (markup, request) {
    var hrefs = links(markup).map(function (href) {
      return href.indexOf("http") !== 0 && href.charAt(0) === "/"
        ? "https://www.desiserials.su" + href
        : href;
    });
    var slugVariants = (request.slugCandidates || []).map(function (s) { return s.toLowerCase(); });
    var candidates = dedupe(
      hrefs.filter(function (href) {
        var path = href.replace(SITE_HOST_RE, "/");
        if (!POST_RE.test(path)) return false;
        var lower = href.toLowerCase();
        return slugVariants.some(function (slug) { return lower.indexOf(slug) !== -1; });
      }),
    );
    if (candidates.length === 0) return [];

    if (request.airDate) {
      var dm = String(request.airDate).toLowerCase().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dm) {
        var MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
        var ord = Number(dm[3]) + ({ 1: "st", 2: "nd", 3: "rd" }[Number(dm[3]) % 10] || "th") + "-" + MONTHS[Number(dm[2]) - 1] + "-" + dm[1];
        var exact = candidates.filter(function (h) {
          return h.toLowerCase().indexOf(ord) !== -1;
        });
        return exact;
      }
      return [];
    }
    var best = 0;
    var bestTs = 0;
    candidates.forEach(function (h, i) {
      var m = h.toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)-([a-z]+)-(\d{4})/);
      var ts = m
        ? Date.UTC(Number(m[3]), MONTH_IDX[m[2]] !== undefined ? MONTH_IDX[m[2]] : 0, Number(m[1]))
        : 0;
      if (ts > bestTs) { bestTs = ts; best = i; }
    });
    return bestTs ? [candidates[best]] : [];
  },
});

export function getStreams(tmdbId, mediaType, season, episode) {
  return provider.getStreams(tmdbId, mediaType, season, episode);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
