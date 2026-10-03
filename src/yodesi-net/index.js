// YoDesi.net Nuvio provider — resolves Indian TV episodes from yodesi.net
// through tvcine.me player pages.
//
// Post page (plain HTML) links out to tvcine.me/player.php?id={n} (4 ids per
// post, all resolving to the same underlying Flow stream — deduped by flowId
// in the chain engine). player.php is static HTML carrying a plain iframe
// src='flow.tvlogy.to/{player,nflix}/{id}/' (single-quoted) — the 32KB of
// obfuscated JS on the page is anti-bot/ad noise, not the player gate.
// Flow pages require the player.php URL as Referer (403 otherwise); the
// chain engine always resolves a backend with the page it was found on.
//
// Post slugs: /{show}-{ordinal}-{fullmonth}-{year}-watch-online/
// Search: WordPress ?s= works; site keeps post history.
//
// All extraction/resolution logic lives in src/lib/chain.js — config only.

import { chainProvider } from "../lib/chain.js";

var provider = chainProvider({
  name: "YoDesi",
  siteBase: "https://www.yodesi.net",
  searchPath: "/?s=",
  hostRe: /^https:\/\/(?:www\.)?yodesi\.net\//i,
  nonPostRe: /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$|\/(about|contact|dmca|privacy|terms|alt-balaji|amazon)\/?$/i,
  mediaTypes: ["tv"],
});

export function getStreams(tmdbId, mediaType, season, episode) {
  return provider.getStreams(tmdbId, mediaType, season, episode);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
