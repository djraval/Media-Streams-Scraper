// DesiTvBox.sbs Nuvio provider — resolves Indian TV episodes from
// desitvbox.sbs via VkSpeed (MP4) embeds and the site's own jw/mobi/fluid
// player pages, which expose a plaintext Yandex Disk HLS master playlist.
//
// Post slugs: {show}-{ordinalDay}-{month}-{year}-video-episode-update-online
// Search:     /search/{space separated terms}/ (path-style, not ?s=)
//
// The chain engine handles this site generically: post harvest finds the
// vkspeed/vkprime iframes (protocol-relative srcs normalized) as backends
// directly, and the local jwplayer.php/mobiplayer.php/player.php links as
// hops whose bodies contain the streamUrl — all config here, no logic.

import { chainProvider } from "../lib/chain.js";
import { episodeDateSlug } from "../lib/tmdb.js";
import { dedupe } from "../lib/html.js";

var provider = chainProvider({
  name: "DesiTvBox.sbs",
  siteBase: "https://desitvbox.sbs",
  hostRe: /^https:\/\/(?:www\.)?desitvbox\.sbs\//i,
  nonPostRe: /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$/i,
  stripTrailingS: true,
  mediaTypes: ["tv"],

  // Post URLs are predictable from slug + air date — try them before search.
  postUrls: function (request, slugs) {
    var dateSlug = episodeDateSlug(request.airDate);
    if (!dateSlug) return [];
    return slugs.map(function (slug) {
      return "https://desitvbox.sbs/" + slug + "-" + dateSlug + "-video-episode-update-online/";
    });
  },

  // Path-style search, date terms first then bare slug.
  searchUrls: function (request, slugs) {
    var dateSlug = episodeDateSlug(request.airDate);
    var urls = [];
    var short = slugs.slice(0, 2);
    if (dateSlug) {
      var dateQuery = dateSlug.replace(/-/g, "+");
      short.forEach(function (slug) {
        urls.push("https://desitvbox.sbs/search/" + slug.replace(/-/g, "+") + "+" + dateQuery + "/");
      });
    }
    short.forEach(function (slug) {
      urls.push("https://desitvbox.sbs/search/" + slug.replace(/-/g, "+") + "/");
    });
    return dedupe(urls);
  },

  // Streams found inside the site's own player-skin pages get labeled by skin.
  hopTag: function (hopUrl) {
    if (hopUrl.indexOf("mobiplayer") !== -1) return "Plyr skin";
    if (hopUrl.indexOf("jwplayer") !== -1) return "JW skin";
    return "Fluid skin";
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
