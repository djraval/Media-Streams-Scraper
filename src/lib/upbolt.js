// UpBolt (upbolt.to) embed resolver — relay variant.
//
// upbolt.to/emb-{id} and /e/{id} sit behind a Cloudflare managed challenge for
// normal clients — but the operator whitelists social link-preview crawlers
// (Facebook/Discord/Telegram/WhatsApp UAs), which receive the real player page.
// The page carries a plaintext jwplayer().setup({sources:[{file:"...m3u8"}]})
// pointing at edgeNN.upbolt.to/hls2/... master playlists with signed tokens
// (~24h).
//
// THE EDGE GATE (added ~Oct 2026): the signed m3u8s/segments are additionally
// fingerprint-gated per-host — curl, wget, python, ffmpeg, OkHttp (Nuvio's
// player) all get 403 on variants/segments regardless of UA/Referer/Origin.
// Only real browsers and node/undici fetch pass. The token is NOT the problem.
//
// THE RELAY: stream URLs are emitted through UPBOLT_RELAY — a tiny m3u8-rewriting
// proxy that fetches upstream with node/undici (gate-passing fingerprint) and
// rewrites every absolute URL in playlist bodies back through itself, so the
// app's player never touches the gated edge directly. Segments are piped
// through untouched. The relay runs wherever an undici-capable host lives;
// the URL below is the current deployment and can be swapped without touching
// resolver logic (self-hosted, ~50 lines, server.js in repo root relay/).
//
// Resolution: fetch embed with crawler UA → first m3u8 in page → emit
// RELAY + enc(master). Master probing for quality also goes via the relay so it
// works identically in-app (OkHttp) and locally (undici).

import { fetchText, resolveFetch } from "./http.js";
import { parseHlsMasterPlaylist } from "./flow.js";

var CRAWLER_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

// Gate-passing HLS relay (rewrites + pipes). Swap when redeploying.
var UPBOLT_RELAY = "https://lanes-knowing-alt-karma.trycloudflare.com/p?u=";

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
    var relayUrl = UPBOLT_RELAY + encodeURIComponent(masterUrl);
    var tag = "";
    var tm = html.match(/<title>([^<]+)<\/title>/i);
    if (tm) tag = tm[1].trim();
    return fetchText(fetchImpl, relayUrl, crawler).then(function (manifest) {
      var stream = {
        backend: "upbolt",
        kind: "hls",
        quality: "",
        url: relayUrl,
        size: "",
        sizeBytes: 0,
        sourceTag: tag,
        // App fetches the relay, which ignores client headers; crawler UA kept
        // so any direct edge touch (cached master HITs) still looks crawler-ish.
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
