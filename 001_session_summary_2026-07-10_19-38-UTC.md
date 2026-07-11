# Session Summary — Nuvio Desi-Serials Repo Refactor

> **Timestamp**: 2026-07-10 19:38:20 UTC

## Repo
- **Path**: `/home/djraval/workspace/anupama-feed`
- **Remote**: `git@github.com:djraval/Media-Streams-Scraper.git` (branch: `main`)
- **Nuvio repo URL**: `https://raw.githubusercontent.com/djraval/Media-Streams-Scraper/main/manifest.json`
- **Current version**: 2.5.2 (in both `manifest.json` and `package.json`)

## What Was Accomplished

### Phase 1-2 (prior session): Dead code deletion + probe file consolidation
- Deleted dead/inactive providers (doodstream-desi, vidguard-desi)
- Deleted standalone probe files (mp4-probe.js, hls-probe.js, quality-probe.js at repo root)
- Reduced from 9,949 lines to ~2,546 lines (74% reduction)

### Phase 3 (this session): esbuild build system + shared lib modules
- Introduced `build.js` (esbuild bundler) — bundles `src/<name>/index.js` → `providers/<name>.js`
- Build config: `target: 'es2020'`, `platform: 'neutral'`, `format: 'cjs'`
- External deps (provided by sandbox): `cheerio-without-node-native`, `crypto-js`, `axios`
- Created `src/lib/` with 9 shared modules (see below)
- Restructured all 5 providers into `src/<name>/index.js` using ES module imports
- All 5 providers rebuilt successfully

### Shared Lib Modules (`src/lib/`)
| File | Lines | Purpose |
|------|-------|---------|
| `constants.js` | 34 | TMDB API key, BROWSER_HEADERS, UA, channel slugs, host arrays |
| `http.js` | 200 | fetchText, fetchJson, fetchBinary (3-strategy fallback), fetchBinaryRange, fetchFileSize, fetchContentLength |
| `html.js` | 152 | dedupe, decodeText, attrValues, links, iframes, embedHostRegex |
| `tmdb.js` | 134 | buildMediaRequest, slugCandidates, episodeDateSlug |
| `packer.js` | 70 | Dean Edwards P.A.C.K.E.R. unpack, JuicyCodes decoder, base64 |
| `vkplayer.js` | 71 | resolveVkPlayer, JW Player source parsing, MP4 ranking, mp4QualityLabel |
| `mp4-probe.js` | 341 | Two-phase MP4 resolution detector (faststart + moov-at-end) |
| `hls-probe.js` | 35 | HLS master playlist resolution parser |
| `format.js` | 79 | formatBytes, formatDuration, toNuvioStream, episode/movie labels |

### 5 Providers (`src/<name>/index.js`)
| Provider | Lines | Content | Players |
|----------|-------|---------|---------|
| `desi-serials-to` | 545 | TV serials | VkPrime, VkSpeed, Flow (3 HLS variants) |
| `desitvserials-se` | 282 | TV serials | VkPrime, VkSpeed |
| `desiruleztv-net` | 302 | TV serials | VkPrime, VkSpeed |
| `mixdrop-desi` | 551 | TV + movies | MixDrop |
| `streamtape-desi` | 866 | TV + movies | StreamTape |
| **Total** | **2,546** | | |

## Key Bug Fixes Applied

### 1. Packer unpack regex (`packer.js`)
- Changed `([^']*)` to `(.*?)` to handle escaped quotes in packer payloads
- Dean Edwards packer payloads sometimes contain escaped single quotes

### 2. VkPlayer MP4 candidate search (`vkplayer.js`)
- `resolveVkPlayer` now combines raw + unpacked content before searching for MP4 candidates
- Matches original behavior — some MP4 URLs only appear after unpacking

### 3. mp4QualityLabel threshold (`vkplayer.js`)
- Returns "unknown" for heights < 480 (was returning a label for any height)
- Matches original behavior

### 4. fetchBinary 3-strategy fallback (`http.js`)
- **Problem**: `response.arrayBuffer()` is unreliable in the Nuvio QuickJS sandbox — may hang or return empty
- **Solution**: Try three strategies in order:
  1. `response.bytes()` — newer Web API, returns Uint8Array directly
  2. `axios` with `responseType: "arraybuffer"` — available via `require()` in sandbox
  3. `fetch` + `response.arrayBuffer()` — last resort (works in Node.js testing)
- Each strategy is a separate function: `fetchBinaryViaBytes`, `fetchBinaryViaAxios`, `fetchBinaryViaFetch`
- `fetchBinaryRange(url, headers, start, end)` orchestrates the fallback chain
- `fetchFileSize(url, headers)` gets total file size via `Range: bytes=0-0` + `Content-Range` header

### 5. Two-phase MP4 probe (`mp4-probe.js`)
- **Problem**: Non-faststart MP4s have the `moov` box at the END of the file, not the front. Phase 1 (fetch first 64KB) finds nothing.
- **Solution**:
  - **Phase 1 — faststart check**: Fetch first 256 bytes, scan top-level boxes. If `moov` appears before `mdat`, it's faststart → fetch first 64KB and parse normally.
  - **Phase 2 — moov-at-end fallback**: If not faststart, call `fetchFileSize()` to get total size, then fetch last 256KB via Range request. Scan backwards for "moov" fourcc (0x6D6F6F76). If moov extends beyond fetched data, re-fetch from moov start (capped at 256KB).
- `detectFaststart(header)` scans top-level boxes in first 256 bytes
- `findMoovBackwards(u8)` scans byte array backwards for moov fourcc with size validation (8 ≤ size ≤ 100MB)

## Local Testing Infrastructure

### `server.js` (new)
- Local HTTP server on port 3000
- Simulates Nuvio's provider calling convention
- Endpoint: `GET /stream?tmdbId=116479&mediaType=tv&season=1&episode=2060`
- Run with: `npm start`

### Build commands
```bash
node build.js                    # Build all providers
node build.js desi-serials-to    # Build one provider
node build.js --watch            # Watch mode
npm start                        # Start local test server (port 3000)
```

### Test commands
```bash
# Test TV provider
node -e "var p = require('./providers/desi-serials-to.js'); p.getStreams('116479', 'tv', 1, 2060).then(function(s) { console.log(s.length + ' streams'); s.forEach(function(x) { console.log('  ' + x.quality + ' ' + x.name); }); });"

# Test movie provider
node -e "var p = require('./providers/mixdrop-desi.js'); p.getStreams('847742', 'movie', null, null).then(function(s) { console.log(s.length + ' streams'); s.forEach(function(x) { console.log('  ' + x.quality + ' ' + x.name); }); });"
```

### Verified test results (local Node.js)
- desi-serials-to: 5 streams (3x Flow 480p, Vkspeed 720p, Vkprime 720p) — 3.3s
- desitvserials-se: 1 stream
- desiruleztv-net: 2 streams
- mixdrop-desi: 2 streams (both 720p)
- streamtape-desi: 0 streams (StreamTape tokens are IP-bound, fail from server)

## Nuvio Versioning — Critical Lesson

**Nuvio reads version from `manifest.json`, NOT `package.json`.**

When bumping versions, you MUST update `manifest.json`:
1. Top-level `"version"` field
2. Each scraper's `"version"` field (5 scrapers)
3. Each scraper's `"filename"` cache-bust param: `"providers/X.js?v=X.Y.Z"` (5 filenames)
4. Total: 11 occurrences in `manifest.json`

The `?v=X.Y.Z` query params on filenames force Nuvio to re-fetch the provider JS files instead of using cached versions.

**Also bump `package.json`** for consistency, but Nuvio doesn't read it.

If Nuvio doesn't show the new version after pushing, the user may need to **remove and re-add the repo** in Nuvio settings to force a fresh manifest fetch.

## Nuvio Sandbox Constraints

- **Engine**: QuickJS (via quickjs-kt), NOT Hermes (Nuvio docs are outdated)
- **NO async/await** — must use Promise chains (.then/.catch)
- **NO Node.js modules** — no fs, path, crypto, child_process, Buffer
- **Available globally**: `fetch()`, `console`, `Promise`, `Set`, `Map`, `URL`, `ArrayBuffer`, `Uint8Array`
- **Available via require()**: `cheerio-without-node-native`, `crypto-js`, `axios`
- **ES2020 features work**: matchAll, flatMap, padStart, Set, Map, URL
- **`response.arrayBuffer()` may NOT work** in Nuvio's fetch binding — this is the biggest risk. The 3-strategy fallback (bytes → axios → arrayBuffer) is critical.
- **DataView works** but Uint8Array is more universally compatible
- **TextDecoder NOT available** — use `String.fromCharCode()` instead
- **Dual export pattern required**:
  ```javascript
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { getStreams: getStreams };
  } else {
    global.getStreams = getStreams;
  }
  ```
  (esbuild handles this automatically with `format: 'cjs'`)
- **Local Node.js tests can pass while in-app fails** — always test in Nuvio Plugin Tester
- **Recommended response time**: < 15 seconds

## Research: Other Nuvio Provider Repos

### Repos analyzed
1. **phisher98/phisher-nuvio-providers** — 46-48 providers, has `build.js` (esbuild) but manifest points to `src/providers/*.js` directly (no bundling). No shared lib directory. `aesdecryptor/` is a private git submodule. Uses `crypto.subtle` (Web Crypto API) for AES-CBC. Has `server.js` + `test.js`.
2. **D3adlyRocket/hindi-nuvio** (cloned to `/tmp/hindi-nuvio`) — 14 Hindi-focused providers, single-file, no build system, no shared libs. Mostly readable (minimal obfuscation).
3. **D3adlyRocket/all-in-one-nuvio** (cloned to `/tmp/all-in-one-nuvio`) — 65+ providers, single-file, heavily obfuscated (string array obfuscation, hex encoding, eval-based unpacking).

### Key findings from research

**Quality detection — the big surprise**: Almost NO Nuvio provider actually probes video files. They all use regex-based quality detection from filenames, labels, or URLs:
- `vegamovies.js`: `parseQuality` with regex `(\d{3,4}p|4K|UHD|HDR)` on text
- `moviesdrive.js`: `parseQ` maps "2160"→"2160p", "1080"→"1080p", etc.
- `cinemacity.js`: `extractQuality` checks URL for `2160p`, `1080p`, etc.
- `4khdhub.js`: `detectQualityFromSources` scans `fileTitle`, `label`, `rawHtml`
- `hdmovie2.js`: **Hardcodes** `'1080p'` regardless of actual file

**Our approach (actual MP4/HLS probing) is more rigorous than the entire ecosystem.** The VkPrime/VkSpeed "360p label but actually 720p" bug proves why regex-guessing is unreliable.

**Sandbox compatibility patterns**:
- `cheerio-without-node-native` is the universal sandbox workaround (12+ providers across repos)
- `AbortController` / `AbortSignal.timeout` for request timeouts
- Environment detection via `typeof window` / `typeof global` / `typeof document`
- `moviebox.js` uses `proxy_url` from worker with "browser-safe, Range-ready" comment

**Binary data handling**: `atob`, custom `atobPolyfill`, `Buffer.from` — all used in different providers. No provider attempts `response.arrayBuffer()` or `response.bytes()` for MP4 parsing — we're the only one doing actual binary probing.

**Repository structure**: Both D3adlyRocket repos are flat `manifest.json` + `providers/*.js` — no shared lib directory, no build system. Our `src/lib/` + `build.js` approach is a significant architectural improvement.

**TMDB keys**: Multiple keys in use across the ecosystem. Our key: `439c478a771f35c05022f9feabcca01c` (wait, actually ours is `4e1899804b6db6d01db1e59391e8a5fe` — see AGENTS.md). Other common keys: `1865f43a0549ca50d341dd9ab8b29f49`, `1b3113663c9004682ed61086cf967c44`, `d80ba92bc7cefe3359668d30d06f3305`, `f3d757824f08ea2cff45eb8f47ca3a1e`.

**Caching**: `moviebox.js` implements custom LRU cache (300 entries, 20 min TTL). Multiple all-in-one providers use `_cachedEndpoint` pattern.

**Stream object structure** (common across all repos):
```javascript
{
  name: "Provider Name",
  title: "Multi-line title",
  url: "stream_url",
  quality: "1080p",
  headers: { "Referer": "...", "User-Agent": "..." },
  behaviorHints: { notWebReady: true, proxyHeaders: {...} }
}
```

## Video Platform Details

### VkPrime/VkSpeed (3 TV providers)
- Embed pages at `vkspeed.com/embed-{id}.html` / `vkprime.com/embed-{id}.html`
- JW Player setup with `sources` array containing MP4 URLs
- May use Dean Edwards P.A.C.K.E.R. obfuscation
- CDN: `*.vkcdn5.com`, `*.vkcdn6.com`
- **Actual resolution is 1280x720 (720p)** despite JW Player labels saying "360p"
- MP4 URLs are NOT IP-bound (work from any IP with Referer header)
- Referer header required: the embed page URL

### Flow (desi-serials-to only)
- HLS streams at `*.tvlogy.to`
- Master playlist with `RESOLUTION=720x480` (labeled "HD" by player)
- **IP-bound tokens** — token contains base64-encoded User-Agent + IP address
- Streams work from the user's device but 404 when probed from a different IP
- 3 Flow variants: embed, plyr, nflix (same stream, different player wrappers)

### MixDrop (mixdrop-desi)
- Embed pages at `mixdrop.ag/e/{id}` (also mixdrop.to, mxdrop.to, mixdrop.ps, mixdrop.sx)
- Uses Dean Edwards P.A.C.K.E.R. — unpack and extract `MDCore.wurl`
- CDN: `*.mxcontent.net` — direct MP4 URL
- Time-limited tokens (~24h) but NOT IP-restricted
- Dead videos: HTML contains "WE ARE SORRY"

### StreamTape (streamtape-desi)
- Embed pages at `streamtape.com/e/{id}` (also streamtape.to, strcloud.club, stape.fun, streamtape.xyz)
- String-based obfuscation: `robotlink` innerHTML JS with `.substring(N)` offsets
- **The `<div id="robotlink">` content is a DECOY** with fake token — must parse the JS
- `get_video` URL → 302 redirect to `*.tapecontent.net` CDN
- Time-limited AND IP-bound tokens
- Single quality (typically 720p)

## Known TMDB IDs (for testing)
| Show | TMDB ID | Type |
|------|---------|------|
| Anupamaa | 116479 | TV (S01, 2000+ episodes) |
| Yeh Rishta Kya Kehlata Hai | 16413 | TV |
| The Great Indian Kapil Show | 247769 | TV |
| Gunaah | 255468 | TV |
| Undekhi | 105759 | TV |
| Bigg Boss | 237227 | TV |
| C.I.D. | 15226 | TV |
| Indian Idol | 13700 | TV |
| Aarya | 104913 | TV |
| Drishyam 3 | 847742 | Movie |
| 3 Idiots | 17250 | Movie |
| Dangal | 362243 | Movie |
| Pathaan | 864692 | Movie |
| Alliance | 326367 | TV |

## Commits (this session)
| SHA | Description |
|-----|-------------|
| `8532b1e` | Full refactor: esbuild build system + shared lib modules |
| `52d550e` | v2.5.0 bump for cache refresh |
| `f77ac61` | Fix: axios-first for binary fetch, fix mp4QualityLabel threshold |
| `fc4ded9` | Fix: two-phase MP4 probe with moov-at-end fallback, add local test server |
| `05a6de3` | Fix: bump manifest.json to 2.5.2 (was still 2.5.1) |
| `f0d283b` | Docs: note that manifest.json drives Nuvio versioning |

## Pending / Next Steps
1. **In-app testing**: The probe fix (two-phase MP4 + 3-strategy fetchBinary) works in local Node.js but needs verification in the actual Nuvio QuickJS sandbox. Test via Nuvio Plugin Tester (debug builds).
2. **If probe fails in sandbox**: The most likely failure point is `response.bytes()` not being available in QuickJS. The axios fallback should catch this, but if axios also fails with arraybuffer, may need to explore alternative binary fetch methods.
3. **Potential improvements** (not yet started):
   - Add regex-guessing as a last-resort fallback when probing fails (hybrid approach, matching what other Nuvio providers do)
   - Add `.gitignore` for `node_modules/` (already exists, but verify)
   - Consider adding `AbortController`/`AbortSignal.timeout` for request timeouts (pattern from movies4u, moviesdrive, vegamovies)
   - Consider custom LRU cache for TMDB lookups (pattern from moviebox.js)

## Key Files to Reference
- `AGENTS.md` — Comprehensive developer notes (architecture, sandbox constraints, platform details, testing commands, gotchas)
- `build.js` — esbuild bundler config
- `manifest.json` — Nuvio repo metadata (version, scraper list, filenames with cache-bust params)
- `package.json` — npm scripts (build, start) and esbuild devDependency
- `server.js` — Local HTTP test server (port 3000)
- `src/lib/http.js` — fetchBinary 3-strategy fallback + fetchFileSize
- `src/lib/mp4-probe.js` — Two-phase MP4 probe (faststart + moov-at-end)
- `src/lib/vkplayer.js` — VkPrime/VkSpeed player resolver
- `src/lib/packer.js` — Dean Edwards P.A.C.K.E.R. unpacker
