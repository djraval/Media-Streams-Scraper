// UpBolt (upbolt.to) embed resolver — DISABLED Oct 2026.
//
// upbolt.to/emb-{id} and /e/{id} sit behind a Cloudflare managed challenge for
// normal clients — but the operator whitelists social link-preview crawlers
// (Facebook/Discord/Telegram/WhatsApp UAs), which receive the real player page.
// The page carries a plaintext jwplayer().setup({sources:[{file:"...m3u8"}]})
// pointing at edgeNN.upbolt.to/hls2/... master playlists with signed tokens
// (~24h).
//
// THE EDGE GATE: the signed m3u8s/segments are fingerprint-gated per-host —
// curl, wget, python, ffmpeg, OkHttp (Nuvio's player) all get 403 on variants
// and segments with ANY token/UA/Referer/Origin/HTTP-version. Only real
// browsers and node/undici fetch pass. Cached edge objects (X-Cache-Status:
// HIT) DO serve denied clients, but fresh objects never enter cache for them.
// The gate is uniform across every host (edgeNN, sNNN, i./gov., main-site
// /hls2); no MP4/download endpoint exists; CF Workers and public proxies are
// fingerprint-denied too. Every emitted stream is therefore a dead link in-app,
// so this backend returns nothing (upbolt is only ever a mirror — posts carry
// VkSpeed/VkPrime MP4s of the same episode, and other providers cover
// upbolt-only posts). A relay could pass the gate (undici fetch upstream +
// playlist URL rewriting) but this pack is scrapers-only by policy.

export var UPBOLT_RE = /upbolt\.to\/(?:emb-|e\/)[A-Za-z0-9_-]+/i;

export function resolveUpbolt() {
  return Promise.resolve(null);
}
