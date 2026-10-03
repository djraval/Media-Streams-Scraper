// DesiTellyBox.to Nuvio provider — resolves Indian TV episodes from
// desitellybox.to through ad-hop landing pages (business-credits.cc,
// credits-loan.pw, ... — domains rotate; the generic .php? query shape is
// what the chain engine follows).
//
// Post page (plain HTML) links:
//   {hop}/media.php?id={n}   → IFRAME SRC="flow.tvlogy.to/{player,plyr}/{id}/"
//   {hop}/flix.php?url={t}   → IFRAME SRC="flow.tvlogy.to/nflix/{id}/"
//   {hop}/media.php?id={n}   → vkspeed.com/embed-{id}-WxH.html in body text
// Post slugs: {show}-{ordinal}-{month}-{year}-watch-online/{postid}/
//
// All extraction/resolution logic lives in src/lib/chain.js — this file is
// config only.

import { chainProvider } from "../lib/chain.js";

var provider = chainProvider({
  name: "DesiTellyBox",
  siteBase: "https://www.desitellybox.to",
  searchPath: "/?s=",
  hostRe: /^https:\/\/(?:www\.)?desitellybox\.to\//i,
  nonPostRe: /\/(category|tag|author|page|wp-|feed|xmlrpc|comments)\b|\/20\d{2}(?:\/\d{2})?\/?$|\/(about-us|contact|dmca|privacy-policy|terms)/i,
  stripTrailingS: true,
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
