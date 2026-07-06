# Design: TypeScript multi-provider refactor

**Date:** 2026-07-09
**Scope:** Restructure the repo from a single hand-edited JS file to a TypeScript source tree
with esbuild bundling, add VkSpeed + full parallel resolution of all 5 player links per episode.

---

## Problem statement

The current `providers/desi-serials-to.js` is a single 633-line hand-edited file written in
Promise-chain style to work around Hermes's lack of `async/await`. As the repo grows to many
scrapers, shared logic (player resolvers, HTTP helpers) would have to be copy-pasted into each
file. The file is also currently incomplete: it only resolves whichever of the 5 player links on
an episode page happens to match `VKPRIME_RE` or `FLOW_RE` first, discarding the rest, and has
no support for `vkspeed.com`. Some of those discarded links may be the only working ones when
vkprime serves a placeholder.

---

## Player link reality

Each episode page on `desi-serials.to` contains exactly 5 `tvarticles.org/vidd.php?id=N` links,
labelled Flash Player / Dailymotion / Netflix / SpeedWatch / VkPrime. Each `vidd.php` page embeds
a single iframe:

| Label       | iframe host                     | Type | Notes                                      |
|-------------|--------------------------------|------|--------------------------------------------|
| Flash Player | `flow.tvlogy.to/embed020A/ID`  | HLS  | JuicyCodes-obfuscated jwplayer             |
| Dailymotion  | `flow.tvlogy.to/plyr020A/ID`   | HLS  | same stream, plyr skin                     |
| Netflix      | `flow.tvlogy.to/nflix020A/ID`  | HLS  | same stream, nflix skin                    |
| SpeedWatch   | `vkspeed.com/embed-SLUG.html`  | MP4  | identical structure to vkprime             |
| VkPrime      | `vkprime.com/embed-SLUG.html`  | MP4  | may serve `/ads/` placeholder when not ready |

All three flow variants resolve to the same underlying HLS URL; both vk variants resolve to the
same MP4 URL when real content is available. Deduplication by stream URL handles this cleanly
without requiring upfront classification.

Placeholder detection: vkprime and vkspeed serve a ~18 MB "Stay Tuned" MP4 at a path containing
`/ads/`. The path `127.0.0.1` also appears in fallback JS. Both are rejected by `isPlaceholderUrl`.

---

## Chosen approach

**TypeScript source tree, esbuild bundle, no separate tsc emit.**

- Write source in `src/` using `async/await` and ES module imports.
- esbuild bundles each scraper's entry point into a single `providers/[name].js`, targeting
  `es2016` (transpiles `async/await` → generators, compatible with Hermes).
- `tsc --noEmit` (type-check only, no emit) runs separately for editor feedback and CI.
- `providers/*.js` are committed as build artifacts so Nuvio can fetch them directly from GitHub
  raw URLs without any runtime build step on the consumer side.

---

## File structure

```
src/
  shared/
    players.ts          ← resolveVkPlayerEmbed, resolveFlowPlayerEmbed, isPlaceholderUrl
                          Stream interface
  desi-serials-to/
    index.ts            ← getStreams() entry point, toNuvioStream() — Nuvio contract
    desi-serials-to.ts  ← all site logic: TMDB lookup, URL building, page crawl,
                          tvarticles link collection, parallel resolution

providers/
  desi-serials-to.js   ← esbuild output, committed

build.js               ← adapted from nuvio template, extended for .ts entry points
package.json           ← esbuild + typescript devDependencies
tsconfig.json          ← strict, noEmit: true, target: ES2016
.gitignore             ← add node_modules/
```

---

## Module responsibilities

### `src/shared/players.ts`

The only genuinely reusable module. Contains everything needed to turn a known embed URL into a
playable stream. No knowledge of desi-serials.to or any other site.

```ts
export interface Stream {
  url: string;
  kind: "mp4" | "hls";
  quality: string;
  size: string;
  headers: Record<string, string>;
  backend: string;
}

// Handles vkprime.com and vkspeed.com (identical page structure).
// Returns null if the page 404s, the MP4 is a placeholder, or no URL is found.
export async function resolveVkPlayerEmbed(embedUrl: string, referer: string): Promise<Stream | null>

// Handles all flow.tvlogy.to variants (embed020A, plyr020A, nflix020A).
// Decodes obfuscation: JuicyCodes wraps a p,a,c,k packer in base64.
// Pipeline: atob(payload) → unpack() → scan for .m3u8 URL.
// Returns null on 403/404 or if no m3u8 is found.
export async function resolveFlowPlayerEmbed(embedUrl: string, referer: string): Promise<Stream | null>

// True for URLs that are known placeholders (path contains /ads/ or host is 127.0.0.1).
export function isPlaceholderUrl(url: string): boolean
```

Regex constants (`VKPRIME_RE`, `VKSPEED_RE`, `FLOW_RE`) also live here and are exported for use
in scrapers that need to classify iframes.

### `src/desi-serials-to/desi-serials-to.ts`

All logic specific to this site. Exports one function:

```ts
export async function resolveDesiSerials(metadata: EpisodeMetadata): Promise<Stream[]>
```

Internally:
1. Builds archive page URL candidates from TMDB data (title slug + channel slug).
   Candidates include pagination variants (`/page/2/`, `/page/3/`) to handle deep archives.
2. Fetches archive pages sequentially until one contains a matching episode link (matched
   by date slug + title slug in the href). Stops as soon as a match is found.
3. Fetches the episode page, collects all `tvarticles.org/vidd.php?id=N` links.
4. Fetches all tvarticles pages in **parallel** (`Promise.all`), extracts the iframe from each.
5. Resolves all iframes in **parallel** (`Promise.all`) using `resolveVkPlayerEmbed` /
   `resolveFlowPlayerEmbed` from `shared/players.ts`.
6. Filters nulls and deduplicates by stream URL. Returns the surviving streams.

TMDB lookup (fetching tv + episode info to get title, air date, networks) is a
`fetchEpisodeMetadata` function defined in this file and exported for `index.ts` to call.
It is not a separate module — it's only ever used by this scraper.

### `src/desi-serials-to/index.ts`

The Nuvio contract. ~25 lines.

```ts
export async function getStreams(
  tmdbId: string,
  mediaType: string,
  season: number,
  episode: number
): Promise<NuvioStream[]>
```

Calls `fetchEpisodeMetadata` (TMDB), then `resolveDesiSerials`, then maps each `Stream` to the
Nuvio stream object shape via `toNuvioStream`. Wraps in try/catch, returns `[]` on failure.

---

## Error handling

- Network failures in `fetchText` return `null` (catch absorbed). Callers check for null.
- `resolveVkPlayerEmbed` / `resolveFlowPlayerEmbed` return `null` on any failure. The `Promise.all` array
  is filtered — one bad link never blocks the others.
- `getStreams` wraps the entire pipeline in try/catch and returns `[]`, so Nuvio always gets
  a valid array.
- No retry logic — if a player is down, the other variants are already being tried in parallel.

---

## Build and typecheck commands

```
npm run build            # node build.js — bundles all src/ providers → providers/*.js
npm run build:watch      # nodemon watch mode for development
npm run typecheck        # tsc --noEmit — type errors only, no emit
```

---

## What changes from the current file

| Current behaviour | New behaviour |
|---|---|
| Promise chains | async/await (esbuild transpiles for Hermes) |
| Only resolves first matching vkprime or flow iframe | Resolves all 5 tvarticles links in parallel |
| No vkspeed.com support | `resolveVkPlayerEmbed` handles vkprime + vkspeed |
| `seenBackends` stops at one vkprime + one flow | Dedup by stream URL only |
| No placeholder detection | `isPlaceholderUrl` filters `/ads/` and `127.0.0.1` |
| Monolithic 633-line file | Split across 3 source files + shared module |
| No type safety | TypeScript strict mode |

---

## What does NOT change

- TMDB lookup logic and request object shape
- URL slug building (title normalisation, channel slug map, date slug)
- Archive page crawl (sequential, stop when episode found)
- `unpack` / `decodeText` / `extractMediaUrls` helpers — same logic, typed
- Nuvio stream object shape and `getStreams` signature
- `manifest.json` — `filename` still points to `providers/desi-serials-to.js`
