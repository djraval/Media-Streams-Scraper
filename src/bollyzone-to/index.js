// Bollyzone.to Nuvio provider — resolves Indian TV episodes from
// bollyzone.to through a two-stage ad gate that launders the referer.
//
// The "Watch Online Links" on each post point at groundbanks.net/item.php?id=N
// pages (adblock-detector + ads). Each item page carries ONE link of the form
//   route.freeshorturls.com/g/{player|plyr|nflix}/{flowId}
// which is just a referer-masking redirector (maskr -> google.com/url) around
//   flow.tvlogy.to/{variant}/{flowId}
// — the same flow.tvlogy HLS backend used elsewhere. The masker chain is
// never fetched: the transform below rewrites the fsu URL straight onto
// flow.tvlogy and the engine resolves it with the item page as Referer,
// which is exactly what the masker was laundering.
//
// Post slugs: /series/{show}-{ordinalDay}-{month}-{year}-watch-online-episode/
// Search:     WordPress /?s={terms}
// Each post lists 3 item links (player/plyr/nflix) sharing ONE flowId —
// three player skins of the same 480p stream.

import { chainProvider } from "../lib/chain.js";
import { episodeDateSlug } from "../lib/tmdb.js";

var SITE_HOST_RE = /^https:\/\/(?:www\.)?bollyzone\.to\//i;
var NON_POST_RE =
  /\/(category|tag|author|page|wp-|feed|xmlrpc|comments|movie|episode)\b/i;
var FSU_RE =
  /(?:route\.)?freeshorturls\.com\/g\/(player|plyr|nflix|embed)\/([A-Za-z0-9_-]+)/i;

var provider = chainProvider({
  name: "Bollyzone",
  siteBase: "https://www.bollyzone.to",
  searchPath: "/?s=",
  hostRe: SITE_HOST_RE,
  nonPostRe: NON_POST_RE,
  mediaTypes: ["tv"],

  // freeshorturls redirect token -> real flow.tvlogy player URL. The variant
  // path segment (player/plyr/nflix) is preserved and doubles as sourceTag.
  transforms: [
    {
      match: FSU_RE,
      expand: function (m) {
        return [
          {
            url: "https://flow.tvlogy.to/" + m[1] + "/" + m[2],
            label: m[1],
          },
        ];
      },
    },
  ],

  // Post URLs are predictable from slug + air date — try them before search.
  postUrls: function (request, slugs) {
    var dateSlug = episodeDateSlug(request.airDate);
    if (!dateSlug) return [];
    return slugs.map(function (slug) {
      return (
        "https://www.bollyzone.to/series/" +
        slug +
        "-" +
        dateSlug +
        "-watch-online-episode/"
      );
    });
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
