// UpBolt (upbolt.to) embed resolver.
//
// upbolt.to/emb-{id} and /e/{id} sit behind a Cloudflare managed challenge for
// normal clients — but the operator whitelists social link-preview crawlers
// (Facebook/Discord/Telegram/WhatsApp UAs), which receive the real player page.
// The page carries a plaintext jwplayer().setup({sources:[{file:"...m3u8"}]})
// pointing at edgeNN.upbolt.to/hls2/... master playlists with signed tokens
// (~24h). The m3u8 itself is portable (no Referer, any UA).
//
// Resolution: fetch embed with a crawler UA → first m3u8 in page → probe the
// master playlist for RESOLUTION/BANDWIDTH.

import { fetchText, resolveFetch } from "./http.js";
import { parseHlsMasterPlaylist } from "./flow.js";

var CRAWLER_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

export var UPBOLT_RE = /upbolt\.to\/(?:emb-|e\/)[A-Za-z0-9_-]+/i;

// /e/{id} is a poster shell: JS POSTs file_code to /dl (op=embed) to reach the
// real player. /emb-{id} serves the player directly. Both emit the same page.
export function resolveUpbolt(embedUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  if (embedUrl.indexOf("http") !== 0) {
    embedUrl = "https://" + embedUrl.replace(/^\/\//, "");
  }
  var idMatch = embedUrl.match(/\/(?:emb-|e\/)([A-Za-z0-9_-]+)/i);
  var crawler = { headers: { "User-Agent": CRAWLER_UA, Accept: "*/*" } };
  var page;
  if (idMatch && /\/e\//i.test(embedUrl)) {
    page = fetchText(fetchImpl, "https://upbolt.to/dl", {
      method: "POST",
      headers: {
        "User-Agent": CRAWLER_UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "op=embed&file_code=" + idMatch[1] + "&auto=1",
    });
  } else {
    page = fetchText(fetchImpl, embedUrl, crawler);
  }
  return page.then(function (html) {
    if (!html) return null;
    var m =
      html.match(/sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+\.m3u8[^"']*)/i) ||
      html.match(/["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i);
    if (!m) return null;
    var masterUrl = m[1].replace(/\\\//g, "/");
    var tag = "";
    var tm = html.match(/<title>([^<]+)<\/title>/i);
    if (tm) tag = tm[1].trim();
    return fetchText(fetchImpl, masterUrl, crawler).then(function (manifest) {
      var stream = {
        backend: "upbolt",
        kind: "hls",
        quality: "",
        url: masterUrl,
        size: "",
        sizeBytes: 0,
        sourceTag: tag,
        // The signed token is bound to the issuing UA class: playlist fetches
        // must carry the crawler UA (the media segments are open). Nuvio applies
        // stream.headers to playlist requests, same as Flow's Referer+UA.
        headers: { "User-Agent": CRAWLER_UA },
      };
      if (manifest) {
        var variants = parseHlsMasterPlaylist(manifest, masterUrl);
        if (variants.length > 0) {
          if (variants[0].height > 0) stream.quality = variants[0].height + "p";
          stream.bandwidth = variants[0].bandwidth;
        }
      }
      return stream;
    });
  });
}
