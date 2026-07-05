# Nuvio Plugin Cleanup — Design

**Date:** 2026-07-05
**Branch:** nuvio
**Status:** Approved (pending spec review)

## Goal

Focus the repo on a single, clean Nuvio client-side JS scraper for `desi-serials.to`, delete the legacy Python scraper, and use a hardcoded TMDB API key (matching the established convention for client-side Nuvio scrapers).

## Non-goals

- Porting `desitvbox.cfd` or `yodesi.net` resolvers. Deferred — revisit if coverage gaps appear.
- Porting `hubref.com`. Dropped — multi-part Yandex-disk chain is brittle and doesn't map to Nuvio's single-stream model.
- Automated tests. Removed by decision. Verification is manual (syntax check + Nuvio Plugin Tester).
- A build/bundling step. Removed. The scraper is a single hand-maintained file using Promise chains (Hermes-compatible).

## Final repo layout

```
anupama-feed/
├── providers/
│   └── desi-serials-to.js   # single hand-maintained scraper file
├── manifest.json            # points at providers/desi-serials-to.js
├── README.md                # rewritten: Nuvio-only install instructions
└── .gitignore
```

### Deleted entirely

- `scraper.py`, `backends.py`, `test_scraper.py` — the Python daily-soap-scraper.
- `__pycache__/`, `pw/` — Python artifacts and Playwright working dir.
- `desi-serials/` — the old multi-file JS plugin tree (`src/`, `backends/`, `tests/`, `scripts/`, `desi-serials.js`, `config.js`).
- `build.js`, `package.json`, `package-lock.json`, `node_modules/` — Node build tooling.
- `live-validation/` — screenshots and frames from manual validation sessions.
- `docs/` — including this spec's own directory once the work is complete (specs are working artifacts, not shipped docs).
- Root `src/` — empty directory.

No build step, no tests, no package.json. Matches the convention of reference repos (D3adlyRocket/All-in-One-Nuvio, phisher98/phisher-nuvio-providers).

## Scraper identity

- **id:** `desi-serials-to`
- **name:** `Desi-Serials.to`
- **filename:** `providers/desi-serials-to.js`
- **supportedTypes:** `["tv"]`
- **formats:** `["mp4", "hls"]`
- **contentLanguage:** `["hi", "en"]`
- **limited:** `true`
- **supportsExternalPlayer:** `true`

No `hasSettings` field — the TMDB key is hardcoded in the scraper file (matching phisher98/MoviesDrive and D3adlyRocket/4khdhub conventions). The id differs from the previous `desi-serials` id. User confirmed no saved Nuvio state to preserve, so the rename is safe.

## TMDB key

The TMDB API key is hardcoded as a top-level constant in the scraper file:

```javascript
const TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe";
```

No settings UI, no `onSettings` export, no `configuredTmdbApiKey()` lookup chain, no `hasSettings` field in the manifest. The key is used directly in `tmdbUrl()`. This matches the established convention for client-side Nuvio scrapers:

- phisher98/phisher-nuvio-providers `moviesdrive.js`: `const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';`
- D3adlyRocket/All-in-One-Nuvio `4khdhub.js`: hardcoded `TMDB_API_KEY` constant.

The key `4e1899804b6db6d01db1e59391e8a5fe` is the one already working via the tailscale funnel.

### Manifest

```json
{
  "name": "Desi-Serials Repo",
  "version": "1.0.0",
  "scrapers": [
    {
      "id": "desi-serials-to",
      "name": "Desi-Serials.to",
      "description": "Indian TV serial resolver using desi-serials.to episode pages plus VkPrime and Flow players.",
      "version": "1.0.0",
      "author": "djraval",
      "supportedTypes": ["tv"],
      "filename": "providers/desi-serials-to.js?v=1",
      "enabled": true,
      "logo": "",
      "contentLanguage": ["hi", "en"],
      "formats": ["mp4", "hls"],
      "limited": true,
      "disabledPlatforms": [],
      "supportsExternalPlayer": true
    }
  ]
}
```

## Scraper file: providers/desi-serials-to.js

A single hand-maintained file. **No async/await** — Hermes does not support async/await in dynamically loaded plugins without transpilation, and there is no build step. All async logic uses Promise chains (`.then()` / `.catch()` / `Promise.all`), matching phisher98's reference scrapers.

### Module exports

```javascript
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
```

This dual export handles both Node-style requires (probe scripts) and Nuvio's global assignment.

### Top-level constants

- `TMDB_BASE = "https://api.themoviedb.org/3"`
- `TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe"`
- `UA` — Chrome desktop User-Agent string (same as current `common.js`).
- `BROWSER_HEADERS = { "User-Agent": UA }`
- `MONTHS` — lowercase month names for date-slug construction.
- `CHANNEL_SLUGS` — map of TMDB network names → desi-serials.to channel slugs (same as current `request.js`).
- Host regexes: `DESI_SERIALS_HOST_RE`, `TVARTICLES_RE`, `VKPRIME_RE`, `FLOW_RE`.

### Shared helper functions (inline, synchronous)

Ported verbatim from the current `desi-serials/src/common.js` and `request.js`:

- `dedupe(values)`
- `decodeText(raw)` — HTML entity + JS-escape decoding.
- `englishOrd(n)` — `1` → `1st`, `2` → `2nd`, etc.
- `episodeDateSlug(isoDate)` — `"2026-07-02"` → `"2nd-july-2026"`.
- `mediaCandidates(raw, extension)`, `mp4Candidates(raw)`, `m3u8Candidates(raw)`
- `attrValues(markup, tags, attrs)`, `links(markup)`, `iframes(markup)`
- `packerEncode(n, base)`, `unpack(blob)` — Dean Edwards packer unpacker.
- `juicycodesPayloads(raw)`, `decodeBase64(payload)`
- `formatBytes(bytes)`
- `normalizeTitle(title)`, `slugCandidates(title)`, `requestSlugCandidates(title, season)`
- `channelSlugCandidates(networks)`

These are pure functions and carry over unchanged from the existing code.

### TMDB + request building (Promise-based)

- `fetchJson(fetchImpl, url)` — returns `fetchImpl(url).then(r => r.json())` with ok-check.
- `tmdbUrl(path, tmdbApiKey)` — builds `https://api.themoviedb.org/3{path}?api_key={key}`.
- `buildMediaRequest(tmdbId, mediaType, season, episode, options)` — fetches `/tv/{id}` and `/tv/{id}/season/{s}/episode/{e}` from TMDB, returns the request object (`title`, `airDate`, `episodeTitle`, `slugCandidates`, `networkCandidates`, `runtimeMinutes`). Implemented as a Promise chain: `fetchJson(tv) → fetchJson(episode) → {request object}`.
- `buildCandidateUrls(request)` — builds the list of `desi-serials.to/watch-online/{channel}/{slug}/` archive URLs (page 1 + page 2 + page 3). Returns `{ desiSerials: [...] }`.

### Stream resolution (Promise-based)

- `fetchText(fetchImpl, url, options)` — `fetchImpl(url, options).then(r => r.text())` with ok-check returning `""` on failure.
- `episodePageCandidates(markup, request)` — filters archive links by host + dateSlug + slug.
- `tvarticlesLinks(markup)` — extracts `tvarticles.org/vidd.php?id=...` links.
- `firstIframe(markup)` — first iframe matching vkprime or flow host.
- `qualityNearUrl(text, url)`, `rankedMp4Candidates(raw)`, `hlsQualityFromManifest(raw)`, `hlsBandwidth(raw)`, `mp4QualityLabel(height)` — quality detection helpers (synchronous, unchanged).
- `parsedDurationSeconds(raw)`, `durationSecondsFromRequest(request)`, `estimatedHlsSize(bandwidth, durationSeconds)` — duration/size estimation (synchronous, unchanged).
- `fetchContentLength(fetchImpl, url, headers)` — HEAD request returning content-length (Promise, 0 on failure).
- `resolveVkprimePlayer(embedUrl, refererUrl, options)` — Promise chain: fetch player → unpack → ranked MP4 candidates → fetchContentLength → `{backend:"vkprime", kind:"mp4", url, quality, size, headers}`.
- `resolveFlowPlayer(playerUrl, refererUrl, options)` — Promise chain: fetch player → m3u8 candidates → fetch manifest → `{backend:"flow", kind:"hls", url, quality, size, headers}`.
- `resolveTvarticlePage(viddUrl, options)` — Promise chain: fetch page → firstIframe → dispatch to vkprime or flow resolver.
- `resolveDesiSerials(request, options)` — Promise chain: for each archive URL → fetch → episodePageCandidates → for each episode URL → fetch → tvarticlesLinks → for each vidd URL → resolveTvarticlePage. Collects streams, dedupes by backend + URL, sorts vkprime first.

### getStreams entry point

```javascript
function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") return Promise.resolve([]);
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: fetch });
    })
    .catch(function (error) {
      console.log("[Desi-Serials.to] getStreams failed: " + error.message);
      return [];
    });
}
```

`getStreamsForRequest` calls `resolveDesiSerials`, dedupes by URL, and maps each backend stream to a Nuvio stream object:

```javascript
{ name: "Desi-Serials.to Vkprime",
  title: "Anupamaa S01E2067 - 720p MP4",
  url: "...", quality: "720p", size: "1.2 GB",
  headers: { Referer: "...", "User-Agent": "..." } }
```

### Stream object format

Matches the documented Nuvio format (yoruix docs + phisher98):

| Field    | Value                                                  |
| -------- | ------------------------------------------------------ |
| `name`   | `"Desi-Serials.to {Backend}"` (e.g. `Vkprime`, `Flow`) |
| `title`  | `"{Show} S{SS}E{EE} - {EpisodeTitle} - {quality} {KIND}"` |
| `url`    | Direct MP4 or HLS master URL                           |
| `quality`| `"720p"`, `"480p"`, `"unknown"`                       |
| `size`   | Human-readable size (`"1.2 GB"`) or `""`              |
| `headers`| `{ Referer, "User-Agent" }` for playback              |

## Source material for the port

The resolver logic is a faithful Promise-chain port of the existing working `desi-serials/src/backends/desiserials.js` (currently esbuild-bundled). The synchronous helpers port verbatim from `desi-serials/src/common.js` and `desi-serials/src/request.js`. No new logic is invented — the only change is async/await → Promise chains and collapsing all files into one.

The hardcoded TMDB key (`4e1899804b6db6d01db1e59391e8a5fe`) is carried over from `desi-serials/src/config.js`. This is the key that already works via the tailscale funnel.

## README

Rewritten to be Nuvio-only:

- **Title:** "Desi-Serials Nuvio Provider"
- **What it does:** resolves Indian TV episodes from `desi-serials.to` via vkprime (MP4) and flow.tvlogy (HLS) players, using TMDB for title + air-date lookup.
- **Install:** add repo manifest URL in Nuvio → Settings → Local Scrapers. Enable `Desi-Serials.to`.
- **Supported:** TV only. Movies return no streams.
- **No build/test tooling** — the scraper is a single committed file.

## Verification

No automated tests. Verification steps:

1. `node -c providers/desi-serials-to.js` — syntax check.
2. `node -e "const s = require('./providers/desi-serials-to.js'); console.log(typeof s.getStreams)"` — module loads, `getStreams` present.
3. (Optional, local only) A throwaway probe script that calls `getStreams` with a real TMDB ID — not committed.
4. Final smoke test via Nuvio Plugin Tester or the tailscale funnel, as previously done.

## Risks and notes

- **No tests mean parser regressions are caught only by manual probing.** Accepted by decision. The `desi-serials.to` markup is the only source and is monitored via the funnel.
- **Hardcoded TMDB key** is committed to the repo. This matches the established pattern (phisher98, 4khdhub both hardcode TMDB keys). Risk: if the repo goes public, the key is shared and could be rate-limited or revoked. Accepted — the repo is private for personal use.
- **Hermes async/await limitation** is handled by using Promise chains throughout. No transpilation needed. Synchronous helpers (regex, unpack, base64) are unaffected.
- **One resolver = one source of failure.** If `desi-serials.to` changes markup or goes down, the scraper returns nothing until fixed. This is the cost of deferring the desitvbox/yodesi ports — accepted, to be revisited if coverage gaps appear.
