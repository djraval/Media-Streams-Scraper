// DesiRulezTV.net Nuvio provider — resolves Indian TV episodes from
// desiruleztv.net via VkPrime/VkSpeed (MP4) players.
// Player iframes are directly in episode page static HTML — no intermediary.
// Protocol-relative iframe srcs (//vkspeed.com/...) are normalized by the
// chain engine's harvester.
//
// Discovery: WordPress ?s= search, then /category/{slug}/ archives (up to
// page 3) as fallback.

import { chainProvider } from "../lib/chain.js";
import { dedupe } from "../lib/html.js";

var provider = chainProvider({
  name: "DesiRulezTV.net",
  siteBase: "https://desiruleztv.net",
  searchPath: "/?s=",
  hostRe: /^https:\/\/(?:www\.)?desiruleztv\.net\//i,
  nonPostRe: /\/category\//i,
  mediaTypes: ["tv"],

  // Each show has /category/{slug}/ plus paginated archives — used when
  // search yields no episode post.
  listingUrls: function (_request, slugs) {
    var urls = [];
    slugs.slice(0, 2).forEach(function (slug) {
      urls.push("https://desiruleztv.net/category/" + slug + "/");
      urls.push("https://desiruleztv.net/category/" + slug + "/page/2/");
      urls.push("https://desiruleztv.net/category/" + slug + "/page/3/");
    });
    return dedupe(urls);
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
