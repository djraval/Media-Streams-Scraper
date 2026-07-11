# Design: vidup-desi + dramavideo-desi providers

**Date:** 2026-07-11
**Scope:** Add two new TV-only providers for Indian daily soaps using two new
video host resolvers — vidup.site (Blogger video) and dramavideo.se (AES-CBC
encrypted HLS).

---

## Problem statement

The existing providers cover Anupamaa and Yeh Rishta Kya Kehlata Hai via
VkPrime/VkSpeed/Flow, but several daily soaps have zero streams:

- **Udne Ki Aasha** — not on desi-serials.to, desitvserials.se, or desiruleztv.net
- **Jhanak** — same
- **Advocate Anjali Awasthi** — same
- **Sairaa** — same
- **Mr and Mrs Parshuram** — same

These shows ARE available on yodesionline.net and desiserialonline.su (both via
vidup.site → Blogger video) and on yehrishtakiakehlatahai.com (via dramavideo.se).
Adding these two providers expands coverage to 10+ additional Star Plus / Zee TV
shows that the existing providers don't cover.

---

## Resolver research (verified end-to-end)

### vidup.site → Blogger video

**Flow (4 HTTP requests, no headless browser):**

1. Fetch episode page from yodesionline.net or desiserialonline.su
   - Extract `vidup.site/play?cd=...` iframe src
2. Fetch `vidup.site/play?cd=...` page
   - Extract Blogger token from `blogger.com/video.g?token=...` iframe src
3. POST to `blogger.com/_/BloggerVideoPlayerUi/data/batchexecute`
   - Body: `f.req=[[["WcwnYd","[\"TOKEN\"]",null,"generic"]]]`
     (URL-encoded as `f.req=%5B%5B%5B%22WcwnYd%22%2C%22%5B%5C%22TOKEN%5C%22%5D%22%2Cnull%2C%22generic%22%5D%5D%5D`)
   - Headers: `Content-Type: application/x-www-form-urlencoded`, `Referer: https://www.blogger.com/video.g`
   - Response: JSON array containing googlevideo.com MP4 URLs
   - The response starts with `)]}'` XSS guard, then newline, then the JSON payload
4. Parse response — extract itag 18 (360p) and itag 22 (720p) URLs

**Constraints:**
- googlevideo URLs are **IP-bound** (the `ip` param must match the requester's IP)
  — same pattern as Flow HLS streams. The URL generated from the user's device
  works for them; server-side probing will 403.
- No Referer needed for batchexecute, but `X-Same-Domain: 1` header helps
- The `WcwnYd` RPC ID is stable (hardcoded in the Blogger SPA JS bundle)
- Multiple `cd` parameters may appear per episode (different servers/parts) —
  each resolves to a different Blogger token/video

**Stream format:** MP4 (googlevideo.com direct URLs)

### dramavideo.se → AES-CBC encrypted HLS

**Flow (4 HTTP requests):**

1. Fetch episode page from yehrishtakiakehlatahai.com
   - Extract `dramavideo.se/watch?v=...` from `data-litespeed-src` iframe attribute
2. Fetch `dramavideo.se/watch?v=...` page
   - Extract `data-video` and `data-provider` attributes from `<li class="linkserver">`
3. Fetch `player.dramavideo.se/?id=...&sv=...` **with `Referer: https://dramavideo.se/`**
   - Without the Referer header, returns 404
   - Extract `encData`, `keyHex`, `ivHex` from inline JavaScript
4. AES-CBC decrypt (two options — **crypto.subtle preferred**):
   - **Option A (preferred): `crypto.subtle`** — already proven in the Nuvio sandbox
     (filemoon provider uses it for AES-GCM). Convert hex key/IV to Uint8Array,
     convert base64 ciphertext to Uint8Array, then:
     ```javascript
     crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"])
       .then(key => crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, ctBytes))
       .then(decrypted => bytesToString(new Uint8Array(decrypted)))
     ```
   - **Option B (fallback): `crypto-js`** — simpler API but not yet tested in sandbox:
     ```javascript
     CryptoJS.enc.Hex.parse(keyHex)  // key
     CryptoJS.enc.Hex.parse(ivHex)   // IV
     CryptoJS.lib.CipherParams.create({ciphertext: CryptoJS.enc.Base64.parse(encData)})
     CryptoJS.AES.decrypt(cipherParams, key, {iv, mode: CBC, padding: Pkcs7})
     ```
   - Decrypted HTML contains `JSON.parse(\`[{file, type, label}]\`)` with HLS URL
   - The `bytesToString` helper already exists in `src/lib/filemoon.js` and uses
     `String.fromCharCode.apply` — reuse it.

**Constraints:**
- **Referer header required** for player.dramavideo.se (critical — 404 without it)
- Key and IV change per request but are embedded in the page HTML
- AES-CBC is fully supported by crypto-js (available in Nuvio sandbox)
- HLS stream at `hls.dramavideo.se/media/...` requires Referer for playback
- The HLS master playlist reports `RESOLUTION=1280x720` (720p)

**Stream format:** HLS (m3u8)

---

## Chosen approach

**Two separate providers, two new resolvers in `src/lib/`.**

- `src/lib/vidup.js` — vidup.site → Blogger video resolver
- `src/lib/dramavideo.js` — dramavideo.se AES-CBC decrypt resolver
- `src/vidup-desi/index.js` — provider using yodesionline.net + desiserialonline.su
- `src/dramavideo-desi/index.js` — provider using yehrishtakiakehlatahai.com

Both providers are TV-only, follow the existing Layer 0-6 scraping pattern, and
reuse existing `src/lib/` modules (http.js, html.js, tmdb.js, format.js).

---

## File structure

```
src/
  lib/
    vidup.js              ← NEW: resolveVidupEmbed(fetchImpl, vidupUrl) → Stream[]
                              vidup.site → Blogger token → batchexecute API → MP4 URLs
    dramavideo.js         ← NEW: resolveDramavideoEmbed(fetchImpl, watchUrl) → Stream[]
                              dramavideo.se/watch → player.dramavideo.se → AES-CBC decrypt → HLS
                              Reuses bytesToString + base64UrlToBytes from filemoon.js
    filemoon.js           ← EXISTING: extract bytesToString, base64UrlToBytes, concatBytes
                              to shared use (or duplicate small helpers in dramavideo.js)
  vidup-desi/
    index.js              ← NEW: getStreams() — searches yodesionline.net + desiserialonline.su
  dramavideo-desi/
    index.js              ← NEW: getStreams() — searches yehrishtakiakehlatahai.com

providers/
  vidup-desi.js           ← NEW: esbuild output
  dramavideo-desi.js      ← NEW: esbuild output

manifest.json             ← Add 2 new scraper entries
package.json              ← Bump version to 2.8.0
build.js                  ← No changes needed (auto-discovers src/ subdirs)
```

---

## Module responsibilities

### src/lib/vidup.js

```javascript
// Resolve a vidup.site embed URL to Blogger video MP4 streams.
// Returns: Promise<Stream[]> — array of {url, quality, name} objects.
//
// Steps:
// 1. Fetch vidup.site/play?cd=... page
// 2. Extract Blogger token from blogger.com/video.g?token=... iframe
// 3. POST to batchexecute API with WcwnYd RPC
// 4. Parse response for googlevideo MP4 URLs (itag 18=360p, 22=720p)
// 5. Return streams with quality labels

export function resolveVidupEmbed(fetchImpl, vidupUrl) { ... }

// Extract the Blogger token from a vidup.site page HTML.
function extractBloggerToken(html) { ... }

// Call the Blogger batchexecute API and return the raw response text.
function bloggerBatchExecute(fetchImpl, token) { ... }

// Parse the batchexecute response and extract googlevideo MP4 URLs.
// Returns: [{url, itag}] where itag 18=360p, 22=720p.
function parseBloggerVideoUrls(responseText) { ... }
```

### src/lib/dramavideo.js

```javascript
// Resolve a dramavideo.se/watch?v=... URL to HLS streams.
// Returns: Promise<Stream[]> — array of {url, quality, name} objects.
//
// Steps:
// 1. Fetch dramavideo.se/watch?v=... page
// 2. Extract data-video and data-provider from <li class="linkserver">
// 3. Fetch player.dramavideo.se/?id=...&sv=... with Referer header
// 4. Extract encData, keyHex, ivHex from page
// 5. AES-CBC decrypt via crypto.subtle (primary) or crypto-js (fallback)
// 6. Parse decrypted HTML for JSON.parse(`[{file, type, label}]`)
// 7. Return HLS stream(s)

export function resolveDramavideoEmbed(fetchImpl, watchUrl) { ... }

// Extract data-video and data-provider from the dramavideo.se/watch page.
function extractServerAttrs(html) { ... }

// Fetch and decrypt the player page.
function decryptPlayerPage(fetchImpl, videoId, provider) { ... }

// AES-CBC decrypt using crypto.subtle (primary) or crypto-js (fallback).
// Reuses bytesToString from filemoon.js for ArrayBuffer → string.
function aesCbcDecrypt(encDataBase64, keyHex, ivHex) { ... }

// Parse decrypted HTML for video sources.
function parseDecryptedSources(html) { ... }
```

### src/vidup-desi/index.js

```javascript
// vidup-desi provider — resolves Indian TV episodes from yodesionline.net
// and desiserialonline.su via vidup.site (Blogger video) player.
//
// Both sites share the same video host (vidup.site) and have identical
// URL patterns for episode pages.

var SITES = [
  { base: "https://yodesionline.net", categoryPath: "/category/" },
  { base: "https://desiserialonline.su", categoryPath: "/category/" },
];

export function getStreams(tmdbId, mediaType, season, episode) { ... }
```

### src/dramavideo-desi/index.js

```javascript
// dramavideo-desi provider — resolves Indian TV episodes from
// yehrishtakiakehlatahai.com via dramavideo.se (AES-CBC encrypted HLS) player.

var SITE_BASE = "https://yehrishtakiakehlatahai.com";

export function getStreams(tmdbId, mediaType, season, episode) { ... }
```

---

## Episode page URL patterns

All three sites use the same date format: `{day}{ordinal}-{month-name}-{year}`
(e.g., `11th-july-2026`). This is already produced by the existing
`episodeDateSlug(isoDate)` function in `src/lib/tmdb.js`.

### yodesionline.net + desiserialonline.su (vidup-desi)

Both sites use WordPress with category-based episode listings:
- Category page: `/{category-slug}/` (e.g., `/category/anupamaa/`)
- Episode page patterns:
  - yodesionline.net: `/{show-slug}-{date-slug}-full-episode-{num}/`
  - desiserialonline.su: `/{show-slug}-{date-slug}-video-episode-{num}/`

Note: the show slug in the episode URL may differ from the category slug.
For example, "Anupamaa" has category `/category/anupamaa/` but episode URLs
use `anupama-` (single 'a'). The existing `slugCandidates()` function
handles this — it generates both "anupamaa" and "anupama" variants.

**URL construction strategy (primary — date-based):**
1. TMDB lookup → get show name, air date, episode number
2. Generate slug candidates via `slugCandidates(title)`
3. Generate date slug via `episodeDateSlug(airDate)`
4. Construct URL candidates: `{slug}-{date}-full-episode-{num}/` etc.
5. Try each URL until one returns a page with vidup.site iframes

**Fallback strategy (if air date is missing from TMDB):**
1. Use WordPress search: `/?s={show-name}+episode+{num}`
2. Parse search results for episode page links matching the episode number
3. Fetch the episode page → extract vidup.site iframe

### yehrishtakiakehlatahai.com (dramavideo-desi)

Episode page URL pattern:
- `/{show-slug}-{date-slug}-episode-{num}-video/`

**URL construction strategy (primary — date-based):**
1. TMDB lookup → get show name, air date, episode number
2. Generate slug candidates via `slugCandidates(title)`
3. Generate date slug via `episodeDateSlug(airDate)`
4. Construct URL: `{slug}-{date}-episode-{num}-video/`
5. Try each slug variant until one returns a page

**Fallback strategy (if air date is missing):**
1. Fetch homepage → find recent episode links for the show
2. If not on homepage, try WordPress search: `/?s={show-name}+episode+{num}`

---

## Stream output

Both providers use the existing `toNuvioStream(request, stream)` function from
`src/lib/format.js`. The stream objects passed to `toNuvioStream` have these fields:

### vidup-desi streams

```javascript
[
  { url: "https://rr3---sn-...googlevideo.com/videoplayback?...",
    quality: "720p", name: "Blogger", kind: "mp4", sourceTag: "blogger" },
  { url: "https://rr3---sn-...googlevideo.com/videoplayback?...",
    quality: "360p", name: "Blogger", kind: "mp4", sourceTag: "blogger" }
]
```

- Format: MP4
- Quality: 720p (itag 22) and 360p (itag 18)
- IP-bound: URLs work from the user's device but not from a server
- No quality probing needed (itag values map to known resolutions)
- No special headers needed for playback

### dramavideo-desi streams

```javascript
[
  { url: "https://hls.dramavideo.se/media/...",
    quality: "720p", name: "DramaVideo", kind: "hls", sourceTag: "dramavideo",
    headers: { Referer: "https://player.dramavideo.se/" } }
]
```

- Format: HLS
- Quality: 720p (from master playlist RESOLUTION tag)
- Not IP-bound (HLS stream works from any IP with Referer header)
- **Referer header required for playback**: `https://player.dramavideo.se/`
- The `headers` field is passed through `toNuvioStream` to the Nuvio stream object

---

## Nuvio sandbox compatibility

### vidup.js
- Uses `fetch()` for HTTP requests — available in QuickJS
- Uses `encodeURIComponent` — available
- No crypto needed (the batchexecute API returns plaintext JSON)
- No async/await — uses Promise chains (.then/.catch)
- IP-bound URLs: same pattern as Flow HLS, handled the same way (no probing)

### dramavideo.js
- Uses `fetch()` for HTTP requests — available in QuickJS
- **Primary: `crypto.subtle`** (Web Crypto API) for AES-CBC decryption — already
  proven in the Nuvio sandbox by the filemoon provider (which uses AES-GCM).
  AES-CBC is a standard crypto.subtle algorithm. The `bytesToString` helper
  from `src/lib/filemoon.js` can be reused for converting the decrypted
  ArrayBuffer to a string.
- **Fallback: `crypto-js`** via `require("crypto-js")` — listed in `build.js`
  EXTERNAL_MODULES. Simpler API but not yet tested in the sandbox. If
  crypto.subtle is unavailable, fall back to crypto-js.
- Hex-to-bytes conversion: simple loop with `parseInt(hex.substr(i, 2), 16)`
- Base64-to-bytes conversion: `atob()` + `charCodeAt()` — both available
- No async/await — uses Promise chains (.then/.catch)

---

## Manifest entries

```json
{
  "id": "vidup-desi",
  "name": "VidUp Desi",
  "description": "Indian TV serial resolver using yodesionline.net and desiserialonline.su with vidup.site (Blogger video) player. Resolves googlevideo MP4 URLs via Blogger batchexecute API.",
  "version": "2.8.0",
  "author": "djraval",
  "supportedTypes": ["tv"],
  "filename": "providers/vidup-desi.js?v=2.8.0",
  "enabled": true,
  "contentLanguage": ["hi", "en"],
  "formats": ["mp4"],
  "limited": true,
  "disabledPlatforms": [],
  "supportsExternalPlayer": true
},
{
  "id": "dramavideo-desi",
  "name": "DramaVideo Desi",
  "description": "Indian TV serial resolver using yehrishtakiakehlatahai.com with dramavideo.se player. Decrypts AES-CBC encrypted player page to extract HLS stream URLs.",
  "version": "2.8.0",
  "author": "djraval",
  "supportedTypes": ["tv"],
  "filename": "providers/dramavideo-desi.js?v=2.8.0",
  "enabled": true,
  "contentLanguage": ["hi", "en"],
  "formats": ["hls"],
  "limited": true,
  "disabledPlatforms": [],
  "supportsExternalPlayer": true
}
```

---

## Testing plan

1. **Unit test resolvers locally:**
   ```bash
   node -e "var p = require('./providers/vidup-desi.js'); p.getStreams('116479', 'tv', 1, 2072).then(function(s) { console.log(s.length + ' streams'); s.forEach(function(x) { console.log('  ' + x.quality + ' ' + x.name); }); });"
   node -e "var p = require('./providers/dramavideo-desi.js'); p.getStreams('116479', 'tv', 1, 2046).then(function(s) { console.log(s.length + ' streams'); s.forEach(function(x) { console.log('  ' + x.quality + ' ' + x.name); }); });"
   ```

2. **Test additional shows:**
   - Udne Ki Aasha (TMDB lookup needed)
   - Jhanak (TMDB lookup needed)
   - Yeh Rishta Kya Kehlata Hai (TMDB ID 16413)

3. **Build verification:**
   ```bash
   node build.js
   for f in providers/*.js; do node -c "$f"; done
   ```

4. **In-app testing:** Test in Nuvio Plugin Tester (debug builds) before shipping
   - vidup-desi: googlevideo URLs are IP-bound, will work in-app but not server-side
   - dramavideo-desi: HLS streams need Referer header, verify Nuvio sends it

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Blogger batchexecute API changes RPC ID | vidup-desi breaks | The `WcwnYd` ID is in the SPA JS bundle; add fallback to scrape it from the page |
| dramavideo.se changes AES key/IV format | dramavideo-desi breaks | Key/IV are per-request in page HTML; just need to update regex if format changes |
| vidup.site changes cd parameter encoding | vidup-desi breaks | The cd parameter is opaque — we just pass it through to vidup.site |
| yodesionline.net/desiserialonline.su change URL patterns | vidup-desi breaks | Use category-based search as fallback, not just URL construction |
| googlevideo URLs expire (6h expiry) | Streams stop working | URLs have `expire` param; user gets fresh URLs on each getStreams call |
| crypto.subtle not available in sandbox | dramavideo-desi breaks | Fall back to crypto-js (listed in EXTERNAL_MODULES); filemoon already proves crypto.subtle works |

---

## Out of scope

- OTT show coverage (Mirzapur, Panchayat, Taaza Khabar) — these are only
  available as "complete season" files on free sites, not per-episode
- StreamWish provider re-enablement — still blocked by sandbox limitations
- rpmplay.xyz (playdesi.com.pk) resolver — Vite SPA with encrypted API,
  high complexity, per-season only
