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
// and is never fetched — the transform below rewrites its URLs straight onto
// articleweb. Unknown gate names emit both probe paths.
//
// Post slugs: /2026/{show}-{ordinal}-{month}-{year}/
// Site keeps ONLY the latest episode post per show.

import { chainProvider } from "../lib/chain.js";
import { links, dedupe } from "../lib/html.js";
import { episodePostCandidates, slugTimestamp } from "../lib/episodes.js";

var ARTICLEWEB = "https://articleweb.xyz/vid/";
var GATE_MAP = { girmeet: "gdrive", kratike: "vkspeed" };
var GATE_PROBES = ["gdrive", "vkspeed"];
var GATE_URL_RE = /\/usn\/([A-Za-z0-9_-]+)\.php\?[^"']*docid=([A-Za-z0-9_-]+)/i;

var SITE_HOST_RE = /^https:\/\/(?:www\.)?tellynagari\.com\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$|\/(about|contact|dmca|privacy|terms)/i;
var LATEST_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

var provider = chainProvider({
  name: "TellyNagari",
  siteBase: "https://tellynagari.com",
  searchPath: "/?s=",
  hostRe: SITE_HOST_RE,
  nonPostRe: NON_POST_RE,
  mediaTypes: ["tv"],

  // tellyduniya gate URL -> articleweb player page(s). Known gates map
  // directly; unknown gates probe both known paths.
  transforms: [
    {
      match: GATE_URL_RE,
      expand: function (m) {
        var gate = m[1].toLowerCase();
        var paths = GATE_MAP[gate]
          ? [GATE_MAP[gate]]
          : GATE_PROBES;
        return paths.map(function (p) {
          return ARTICLEWEB + p + ".php?id=" + encodeURIComponent(m[2]);
        });
      },
    },
  ],

  // Tellynagari keeps only the LATEST episode post per show: strict matching
  // misses older eps, and an air-dated request must not be served the newest
  // post. Only undated requests may accept a single fresh dated post.
  postCandidates: function (markup, request) {
    var hrefs = links(markup);
    var strict = episodePostCandidates(hrefs, request, SITE_HOST_RE, NON_POST_RE);
    if (strict.length > 0) return strict;
    if (request.airDate) return [];
    var dated = dedupe(
      hrefs.filter(function (href) {
        return (
          SITE_HOST_RE.test(href) &&
          !NON_POST_RE.test(href) &&
          slugTimestamp(href) > 0 &&
          (request.slugCandidates || []).some(function (slug) {
            return href.toLowerCase().indexOf(slug) !== -1;
          })
        );
      }),
    );
    if (dated.length !== 1) return [];
    if (Math.abs(Date.now() - slugTimestamp(dated[0])) > LATEST_WINDOW_MS) return [];
    return dated;
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
