// UpBolt (upbolt.to) embed resolver — DISABLED (Oct 10, 2026).
//
// What changed: upbolt's edge now fingerprint-gates its signed HLS URLs at the
// ORIGIN, not just the embed page at Cloudflare. Verified same-day:
//   - master.m3u8 returns 200 only on edge cache HITs; on MISS the origin 403s
//   - variant playlists and .ts segments 403 at origin for curl, wget, python
//     urllib and ffmpeg/ffprobe — every non-browser fingerprint — with ANY
//     token, Referer, Origin or UA
//   - the SAME signed URL fetches fine from real Chrome and from node/undici —
//     the gate is the client's TLS/HTTP fingerprint, not the token class
//   - Cloudflare now managed-challenges even the crawler-UA whitelist
//     (facebookexternalhit/Discordbot/Twitterbot all get "Just a moment")
//
// Effect in-app: the provider could still mint URLs through undici-class
// fingerprints, but Nuvio's player stack is rejected → the stream lists, then
// playback dies on the first variant/segment ("HTTP error"). A dead link is
// worse than no link (upbolt is only ever a mirror — the same posts carry
// VkSpeed/VkPrime MP4s of the same episode), so resolution is skipped
// entirely. This also saves the serial embed+playlist RTTs.
//
// Previous mechanism (for re-enable if the gate is lifted): fetch emb-{id}
// with a link-preview crawler UA → jwplayer().setup sources[0].file →
// edgeNN.upbolt.to/hls2/... master.m3u8 signed ~24h.

export var UPBOLT_RE = /upbolt\.to\/(?:emb-|e\/)[A-Za-z0-9_-]+/i;

export function resolveUpbolt() {
  return Promise.resolve(null);
}
