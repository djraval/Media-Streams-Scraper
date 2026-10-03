// YoDesiOnline.net Nuvio provider — resolves Indian TV episodes from
// yodesionline.net via VkPrime/VkSpeed (MP4) players.
// Player iframes sit directly in the episode post markup.
//
// Post slugs: {show}-{ordinal}-{fullmonth}-{year}-full-episode/
// Direct post URLs are predictable from slug + air date — tried first,
// then WordPress ?s= search.

import { chainProvider } from "../lib/chain.js";
import { episodeDateSlug } from "../lib/tmdb.js";

var provider = chainProvider({
  name: "YoDesiOnline.net",
  siteBase: "https://yodesionline.net",
  searchPath: "/?s=",
  hostRe: /^https:\/\/(?:www\.)?yodesionline\.net\//i,
  stripTrailingS: true,
  mediaTypes: ["tv"],

  postUrls: function (request, slugs) {
    var dateSlug = episodeDateSlug(request.airDate);
    if (!dateSlug) return [];
    return slugs.map(function (slug) {
      return "https://yodesionline.net/" + slug + "-" + dateSlug + "-full-episode/";
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
