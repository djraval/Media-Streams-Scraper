# TypeScript Multi-Provider Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the repo from a single hand-edited JS file into a TypeScript source tree with esbuild bundling, add VkSpeed support, parallel resolution of all 5 player links per episode, and placeholder filtering.

**Architecture:** Source lives in `src/` using async/await with ES module imports. esbuild bundles each scraper's entry point into a single `providers/[name].js` targeting ES2016 (transpiles async/await to generators for Hermes). `tsc --noEmit` provides type checking. Shared player resolvers live in `src/shared/players.ts` and are imported by any scraper that encounters vkprime/vkspeed/flow.tvlogy embeds.

**Tech Stack:** TypeScript (strict), esbuild (bundler + transpiler), Node.js (build tooling only)

**Spec:** `docs/superpowers/specs/2026-07-09-ts-multi-provider-refactor-design.md`

---

## File Structure

```
src/
  shared/
    players.ts              ← resolveVkPlayerEmbed, resolveFlowPlayerEmbed, isPlaceholderUrl
                              Stream interface, VKPRIME_RE, VKSPEED_RE, FLOW_RE
  desi-serials-to/
    index.ts                ← getStreams() entry point, toNuvioStream()
    desi-serials-to.ts      ← fetchEpisodeMetadata, resolveDesiSerials, all site logic
                              helpers: dedupe, decodeText, extractMediaUrls, extractAttrValues,
                              extractLinks, extractIframes, unpack, packerEncode, formatBytes,
                              normalizeTitle, buildTitleSlugCandidates, channelSlugCandidates,
                              episodeDateSlug, fetchText, fetchJson

providers/
  desi-serials-to.js        ← esbuild output (committed build artifact)

build.js                    ← esbuild bundler script
package.json                ← esbuild + typescript devDependencies
tsconfig.json               ← strict, noEmit, target ES2016
.gitignore                  ← add node_modules/ (already present)
manifest.json               ← update version + description
README.md                   ← update for build workflow
```

### Key interface definitions (used across tasks)

```typescript
// src/shared/players.ts
export interface Stream {
  url: string;
  kind: "mp4" | "hls";
  quality: string;
  size: string;
  headers: Record<string, string>;
  backend: string;
}

// src/desi-serials-to/desi-serials-to.ts
// Episode metadata fetched from TMDB, used to build archive URLs and match episode pages.
export interface EpisodeMetadata {
  title: string;
  mediaType: string;
  season: number;
  episode: number;
  airDate: string;
  episodeTitle: string;
  networkCandidates: string[];
  runtimeMinutes: number | null;
  slugCandidates: string[];
  fallbackChannelSlugs: string[];
}

// src/desi-serials-to/index.ts
export interface NuvioStream {
  name: string;
  title: string;
  url: string;
  quality: string;
  size: string;
  headers: Record<string, string>;
}
```

---

## Task 1: Set up build toolchain (package.json, tsconfig.json, build.js)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `build.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "media-streams-scraper",
  "version": "1.0.0",
  "description": "Nuvio scrapers for Indian TV streaming sites",
  "scripts": {
    "build": "node build.js",
    "build:watch": "node build.js --watch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "typescript": "^5.4.0"
  },
  "license": "GPL-3.0"
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2016",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./providers",
    "rootDir": "./src",
    "lib": ["ES2016", "DOM"],
    "types": []
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "providers"]
}
```

- [ ] **Step 3: Create build.js**

This is adapted from the nuvio-providers template. Key changes: entry point can be `.ts`, esbuild handles TypeScript natively (strips types + transpiles to ES2016).

```javascript
#!/usr/bin/env node

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const outDir = path.join(__dirname, 'providers');

const EXTERNAL_MODULES = [
  'cheerio-without-node-native',
  'react-native-cheerio',
  'cheerio',
  'crypto-js',
  'axios'
];

function getProvidersToBuild() {
  const args = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  if (args.length > 0) {
    return args;
  }
  if (!fs.existsSync(srcDir)) {
    console.error('src/ directory not found');
    process.exit(1);
  }
  return fs.readdirSync(srcDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'shared')
    .map(d => d.name);
}

async function buildProvider(providerName) {
  const providerDir = path.join(srcDir, providerName);
  const entryTs = path.join(providerDir, 'index.ts');
  const entryJs = path.join(providerDir, 'index.js');
  const entryPoint = fs.existsSync(entryTs) ? entryTs : entryJs;
  const outFile = path.join(outDir, `${providerName}.js`);

  if (!fs.existsSync(entryPoint)) {
    console.warn(`Skipping ${providerName}: no index.ts or index.js found`);
    return false;
  }

  try {
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: outFile,
      format: 'cjs',
      platform: 'neutral',
      target: 'es2016',
      minify: false,
      sourcemap: false,
      external: EXTERNAL_MODULES,
      banner: {
        js: `/**\n * ${providerName} - Built from src/${providerName}/\n * Generated: ${new Date().toISOString()}\n */`
      },
      logLevel: 'warning'
    });

    const stats = fs.statSync(outFile);
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`Built ${providerName}.js (${sizeKB} KB)`);
    return true;
  } catch (err) {
    console.error(`Failed to build ${providerName}:`, err.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  if (watch) {
    const providers = getProvidersToBuild();
    console.log(`Watching ${providers.length} provider(s)...`);
    const ctx = await esbuild.context({
      entryPoints: providers.map(p => {
        const dir = path.join(srcDir, p);
        const ts = path.join(dir, 'index.ts');
        return fs.existsSync(ts) ? ts : path.join(dir, 'index.js');
      }),
      bundle: true,
      outdir: outDir,
      format: 'cjs',
      platform: 'neutral',
      target: 'es2016',
      minify: false,
      sourcemap: false,
      external: EXTERNAL_MODULES,
      logLevel: 'warning'
    });
    await ctx.watch();
  } else {
    const providers = getProvidersToBuild();
    if (providers.length === 0) {
      console.log('No providers found in src/');
      return;
    }
    console.log(`Building ${providers.length} provider(s)...`);
    let success = 0;
    let failed = 0;
    for (const provider of providers) {
      const result = await buildProvider(provider);
      if (result) success++; else failed++;
    }
    console.log(`Done! ${success} built, ${failed} failed`);
  }
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Install dependencies**

Run: `cd /home/djraval/workspace/anupama-feed && npm install`
Expected: `node_modules/` created, `package-lock.json` generated, no errors.

- [ ] **Step 5: Verify typecheck runs (no .ts files yet, should succeed with no input)**

Run: `cd /home/djraval/workspace/anupama-feed && npx tsc --noEmit`
Expected: Exits 0 (no files to check, or empty output).

- [ ] **Step 6: Verify build.js runs (no providers yet)**

Run: `cd /home/djraval/workspace/anupama-feed && node build.js`
Expected: "No providers found in src/" or "Building 0 provider(s)... Done! 0 built, 0 failed"

- [ ] **Step 7: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add package.json package-lock.json tsconfig.json build.js .gitignore
git commit -m "chore: add TypeScript + esbuild build toolchain"
```

---

## Task 2: Create shared/players.ts (player resolvers + placeholder detection)

**Files:**
- Create: `src/shared/players.ts`

This module is the genuinely reusable piece. It knows how to resolve embed URLs from
vkprime.com, vkspeed.com (identical structure), and flow.tvlogy.to (all path variants)
into playable streams. No knowledge of any specific scraper site.

**Critical bug fix in this task:** The current scraper's flow resolver does NOT decode
JuicyCodes obfuscation (base64-wrapped p,a,c,k packer). It only works on plyr020A/nflix020A
variants which expose `sources` JSON directly. The embed020A (Flash Player) variant wraps
the player config in `JuicyCodes.Run("base64...")` which decodes to a packer. The new
`resolveFlowPlayerEmbed` must handle both: try direct m3u8 extraction first, then fall back to
JuicyCodes decode (atob + unpack).

- [ ] **Step 1: Create src/shared/players.ts with interfaces and regexes**

```typescript
// Shared player resolvers for Nuvio scrapers.
// Handles vkprime.com, vkspeed.com (MP4), and flow.tvlogy.to (HLS) embed pages.

export interface Stream {
  url: string;
  kind: "mp4" | "hls";
  quality: string;
  size: string;
  headers: Record<string, string>;
  backend: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = { "User-Agent": UA };

export const VKPRIME_RE = /^https:\/\/vkprime\.com\/embed-[A-Za-z0-9-]+\.html$/i;
export const VKSPEED_RE = /^https:\/\/vkspeed\.com\/embed-[A-Za-z0-9-]+\.html$/i;
export const FLOW_RE = /^https:\/\/flow\.tvlogy\.to\/[A-Za-z0-9/_-]+\/?$/i;

export function isPlaceholderUrl(url: string): boolean {
  const lower = String(url || "").toLowerCase();
  return lower.includes("/ads/") || lower.startsWith("https://127.0.0.1") || lower.startsWith("http://127.0.0.1");
}
```

- [ ] **Step 2: Add base64 decode helper (Hermes-safe)**

Hermes has `atob` but with strict padding requirements. We implement a small base64 decoder
that handles missing padding to be safe across all Hermes versions.

```typescript
// Add after isPlaceholderUrl in src/shared/players.ts

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(raw: string): string {
  const input = String(raw || "").replace(/[^A-Za-z0-9+/]/g, "");
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const char of input) {
    const idx = B64_CHARS.indexOf(char);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}
```

- [ ] **Step 3: Add HTML parsing helpers**

These are the parsing utilities needed by the player resolvers. They extract URLs and
attribute values from HTML markup using regex (no DOM parser in Hermes).

```typescript
// Add after decodeBase64 in src/shared/players.ts

function decodeText(raw: string): string {
  let text = String(raw || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  const replacements: Array<[RegExp, string]> = [
    [/\\\//gi, "/"],
    [/\\u0026/gi, "&"],
    [/\\u003d/gi, "="],
    [/\\u003f/gi, "?"],
    [/\\u002f/gi, "/"],
    [/\\x26/gi, "&"],
    [/\\x3d/gi, "="],
    [/\\x3f/gi, "?"],
    [/\\x2f/gi, "/"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&");
}

function dedupe<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function extractMediaUrls(raw: string, extension: string): string[] {
  const text = decodeText(raw);
  const pattern = new RegExp(
    "https?://[^\\s'\\\"<>\\\\,}\\]]+\\." +
      extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(?:\\?[^\\s'\\\"<>\\\\}\\]]*)?",
    "gi",
  );
  return dedupe(
    Array.from(text.matchAll(pattern), (match) =>
      match[0].replace(/[.;)]+$/g, ""),
    ),
  );
}

function extractIframes(markup: string): string[] {
  const tagPattern = /<\s*iframe\b[^>]*>/gis;
  const attrPattern = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
  const values: string[] = [];
  for (const tag of String(markup || "").matchAll(tagPattern)) {
    const attr = tag[0].match(attrPattern);
    if (attr) {
      values.push(decodeText((attr[1] || attr[2] || attr[3] || "").trim()));
    }
  }
  return dedupe(values);
}
```

- [ ] **Step 4: Add packer decoder (unpack)**

The p,a,c,k packer is used by flow.tvlogy.to to obfuscate player config. This is the same
algorithm as the current scraper, ported to TypeScript.

```typescript
// Add after extractIframes() in src/shared/players.ts

function packerEncode(n: number, base: number): string {
  if (n === 0) return "0";
  let out = "";
  let value = n;
  while (value > 0) {
    const r = value % base;
    if (r < 10) {
      out = String.fromCharCode(48 + r) + out;
    } else if (r < 36) {
      out = String.fromCharCode(87 + r) + out;
    } else {
      out = String.fromCharCode(29 + r) + out;
    }
    value = Math.floor(value / base);
  }
  return out;
}

function unpack(blob: string): string {
  const match = String(blob || "").match(
    /eval\(function\(p,a,c,k,e,(?:d|r)\).*?\}\s*\(\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([^']*)'\.split\('\|'\)/s,
  );
  if (!match) return "";
  const p = match[1].replace(/\\'/g, "'");
  const base = Number(match[2]);
  const count = Number(match[3]);
  const keys = match[4].replace(/\\'/g, "'").split("|");
  let out = p;
  for (let i = count - 1; i >= 0; i -= 1) {
    if (!keys[i]) continue;
    const token = packerEncode(i, base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${token}\\b`, "g"), keys[i]);
  }
  return out;
}
```

- [ ] **Step 5: Add JuicyCodes decoder**

JuicyCodes wraps a p,a,c,k packer in base64. The payload is split across multiple
string literals concatenated with `+`. We extract all quoted fragments, concatenate,
base64-decode, then run `unpack`.

```typescript
// Add after unpack() in src/shared/players.ts

function decodeJuicyCodes(html: string): string {
  const match = String(html || "").match(/JuicyCodes\.Run\(([^)]+)\)/s);
  if (!match) return "";
  const fragments = match[1].match(/"([^"]*)"/g);
  if (!fragments) return "";
  const payload = fragments.map((f) => f.replace(/^"|"$/g, "")).join("");
  const decoded = decodeBase64(payload);
  return unpack(decoded);
}
```

- [ ] **Step 6: Add fetchText and fetchContentLength helpers**

```typescript
// Add after decodeJuicyCodes() in src/shared/players.ts

async function fetchText(url: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: headers || {} });
    if (!response || !response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchContentLength(url: string, headers: Record<string, string>): Promise<number> {
  try {
    const response = await fetch(url, { method: "HEAD", headers });
    if (!response || !response.ok || !response.headers) return 0;
    return Number(response.headers.get("content-length") || 0) || 0;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[index]}`;
}
```

- [ ] **Step 7: Add quality extraction helpers**

```typescript
// Add after formatBytes() in src/shared/players.ts

function qualityNearUrl(text: string, url: string): number | null {
  const index = text.indexOf(url);
  if (index === -1) return null;
  const after = text.slice(index, index + url.length + 160);
  const afterMatch = after.match(/\b(?:label|quality|res|resolution)['"]?\s*[:=]\s*['"]?(\d{3,4})p?\b/i)
    || after.match(/\b(\d{3,4})p\b/i);
  if (afterMatch) return Number(afterMatch[1]);
  const before = text.slice(Math.max(0, index - 160), index);
  const matches = [
    ...before.matchAll(/\b(?:label|quality|res|resolution)['"]?\s*[:=]\s*['"]?(\d{3,4})p?\b/gi),
    ...before.matchAll(/\b(\d{3,4})p\b/gi),
  ];
  if (matches.length === 0) return null;
  return Number(matches[matches.length - 1][1]);
}

function mp4QualityLabel(height: number | null): string {
  if (!height) return "unknown";
  return height < 480 ? "unknown" : height + "p";
}

function hlsQualityFromManifest(raw: string): string {
  const match = String(raw || "").match(/RESOLUTION=\d+x(\d{3,4})/i);
  return match ? match[1] + "p" : "unknown";
}
```

- [ ] **Step 8: Add resolveVkPlayerEmbed (handles vkprime + vkspeed)**

VkPrime and VkSpeed have identical page structure: an embed HTML page containing a
jwplayer setup with `file: "https://host/...mp4"`. The MP4 may be a placeholder under
`/ads/` path. We extract all MP4 candidates, rank by quality, pick the best, check
for placeholder, fetch content-length for size display.

```typescript
// Add after quality helpers in src/shared/players.ts

export async function resolveVkPlayerEmbed(embedUrl: string, referer: string): Promise<Stream | null> {
  const player = await fetchText(embedUrl, {
    ...BROWSER_HEADERS,
    Referer: referer,
  });
  if (!player) return null;

  const payload = player + "\n" + unpack(player);
  const text = decodeText(payload);
  const candidates = extractMediaUrls(text, "mp4");
  if (candidates.length === 0) return null;

  // Rank by quality (nearest quality label in surrounding text)
  const ranked = candidates
    .map((url) => ({ url, quality: qualityNearUrl(text, url) || 0 }))
    .sort((a, b) => b.quality - a.quality);

  const best = ranked[0];
  if (isPlaceholderUrl(best.url)) return null;

  const headers: Record<string, string> = { Referer: embedUrl, "User-Agent": UA };
  const contentLength = await fetchContentLength(best.url, headers);
  const backend = embedUrl.includes("vkspeed") ? "vkspeed" : "vkprime";

  return {
    url: best.url,
    kind: "mp4",
    quality: mp4QualityLabel(best.quality),
    size: formatBytes(contentLength),
    headers,
    backend,
  };
}
```

- [ ] **Step 9: Add resolveFlowPlayerEmbed (handles all flow.tvlogy.to variants)**

Flow.tvlogy.to has three path variants: embed020A (JuicyCodes obfuscated), plyr020A
(direct sources JSON), nflix020A (direct sources JSON). We try direct m3u8 extraction
first (works for plyr/nflix), then fall back to JuicyCodes decode (needed for embed020A).

```typescript
// Add after resolveVkPlayerEmbed in src/shared/players.ts

export async function resolveFlowPlayerEmbed(embedUrl: string, referer: string): Promise<Stream | null> {
  const player = await fetchText(embedUrl, {
    ...BROWSER_HEADERS,
    Referer: referer,
  });
  if (!player) return null;

  // Try direct m3u8 extraction (works for plyr020A, nflix020A)
  let masterUrl = extractMediaUrls(decodeText(player), "m3u8")[0] || "";

  // Fall back to JuicyCodes decode (needed for embed020A)
  if (!masterUrl) {
    const decoded = decodeJuicyCodes(player);
    masterUrl = extractMediaUrls(decodeText(decoded), "m3u8")[0] || "";
  }

  if (!masterUrl) return null;

  // Fetch master manifest to determine quality
  const manifest = await fetchText(masterUrl, {
    ...BROWSER_HEADERS,
    Referer: embedUrl,
  });

  const headers: Record<string, string> = { Referer: embedUrl, "User-Agent": UA };
  return {
    url: masterUrl,
    kind: "hls",
    quality: hlsQualityFromManifest(manifest || ""),
    size: "",
    headers,
    backend: "flow",
  };
}
```

- [ ] **Step 10: Add iframe classification helper**

Scrapers need to classify an iframe URL to know which resolver to call. This helper
returns the appropriate resolver or null.

```typescript
// Add after resolveFlowPlayerEmbed in src/shared/players.ts

export type PlayerResolver = (embedUrl: string, referer: string) => Promise<Stream | null>;

export function resolverForIframe(iframeUrl: string): { backend: string; resolve: PlayerResolver } | null {
  if (VKPRIME_RE.test(iframeUrl)) {
    return { backend: "vkprime", resolve: resolveVkPlayerEmbed };
  }
  if (VKSPEED_RE.test(iframeUrl)) {
    return { backend: "vkspeed", resolve: resolveVkPlayerEmbed };
  }
  if (FLOW_RE.test(iframeUrl)) {
    return { backend: "flow", resolve: resolveFlowPlayerEmbed };
  }
  return null;
}
```

- [ ] **Step 11: Verify typecheck passes**

Run: `cd /home/djraval/workspace/anupama-feed && npx tsc --noEmit`
Expected: No errors (file has no imports to resolve yet, all self-contained).

- [ ] **Step 12: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add src/shared/players.ts
git commit -m "feat: add shared player resolvers with JuicyCodes + placeholder detection"
```

---

## Task 3: Create desi-serials-to.ts (site-specific logic)

**Files:**
- Create: `src/desi-serials-to/desi-serials-to.ts`

This file contains all logic specific to desi-serials.to: TMDB lookup, URL slug building,
archive page crawl, episode page parsing, tvarticles link collection, and parallel resolution
of all player links. It exports `fetchEpisodeMetadata` and `resolveDesiSerials`.

- [ ] **Step 1: Create file with constants and interfaces**

```typescript
// Desi-Serials.to scraper — site-specific logic.
// Uses shared player resolvers from ../shared/players.ts

import { Stream, resolverForIframe, isPlaceholderUrl } from "../shared/players";

export interface EpisodeMetadata {
  title: string;
  mediaType: string;
  season: number;
  episode: number;
  airDate: string;
  episodeTitle: string;
  networkCandidates: string[];
  runtimeMinutes: number | null;
  slugCandidates: string[];
  fallbackChannelSlugs: string[];
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BROWSER_HEADERS: Record<string, string> = { "User-Agent": UA };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const CHANNEL_SLUGS: Record<string, string[]> = {
  "& tv": ["and-tv"],
  "&tv": ["and-tv"],
  "and tv": ["and-tv"],
  "colors": ["color-tv-hd", "colors-tv"],
  "colors tv": ["color-tv-hd", "colors-tv"],
  "dangal tv": ["dangal-tv"],
  "sab tv": ["sab-tv-hd", "sab-tv"],
  "sony sab": ["sab-tv-hd", "sab-tv"],
  "sony tv": ["sony-tv"],
  "star bharat": ["star-bharat"],
  "star plus": ["star-plus"],
  "zee tv": ["zee-tv"],
};

const DESI_SERIALS_HOST_RE = /^https:\/\/www\.desi-serials\.to\//i;
const TVARTICLES_RE = /^https:\/\/tvarticles\.org\/vidd\.php\?id=\d+/i;
```

- [ ] **Step 2: Add pure helpers (dedupe, decodeText, slug building, date slug)**

```typescript
// Add after constants in src/desi-serials-to/desi-serials-to.ts

function dedupe<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function decodeText(raw: string): string {
  return String(raw || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeTitle(title: string): string {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugCandidates(title: string): string[] {
  const base = normalizeTitle(title);
  if (!base) return [];
  const candidates = [base];
  if (base.includes("aa")) {
    candidates.push(base.replace(/aa/g, "a"));
  }
  return dedupe(candidates);
}

function buildTitleSlugCandidates(title: string, season: number): string[] {
  const candidates = slugCandidates(title);
  if (season > 1 && candidates.length > 0) {
    candidates.push(`${candidates[0]}-${season}`);
  }
  return dedupe(candidates);
}

function channelSlugCandidates(networks: string[]): string[] {
  const candidates: string[] = [];
  for (const network of networks || []) {
    const key = String(network || "").trim().toLowerCase();
    if (CHANNEL_SLUGS[key]) {
      candidates.push(...CHANNEL_SLUGS[key]);
    }
  }
  return dedupe(candidates);
}

function episodeDateSlug(isoDate: string): string {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const day = Number(match[3]);
  const suffix =
    day % 100 >= 10 && day % 100 <= 20
      ? "th"
      : { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";
  const month = MONTHS[Number(match[2]) - 1];
  return `${day}${suffix}-${month}-${match[1]}`;
}
```

- [ ] **Step 3: Add HTML parsing helpers (extractLinks, extractIframes)**

```typescript
// Add after date slug helper in src/desi-serials-to/desi-serials-to.ts

function extractAttrValues(markup: string, tags: string[], attrs: string[]): string[] {
  const tagAlternation = tags.join("|");
  const attrAlternation = attrs.join("|");
  const tagPattern = new RegExp(`<\\s*(${tagAlternation})\\b[^>]*>`, "gis");
  const attrPattern = new RegExp(
    `\\b(${attrAlternation})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const values: string[] = [];
  for (const tag of String(markup || "").matchAll(tagPattern)) {
    const attr = tag[0].match(attrPattern);
    if (attr) {
      values.push(decodeText((attr[2] || attr[3] || attr[4] || "").trim()));
    }
  }
  return dedupe(values);
}

function extractLinks(markup: string): string[] {
  return extractAttrValues(markup, ["a", "link", "area"], ["href"]);
}

function extractIframes(markup: string): string[] {
  return extractAttrValues(markup, ["iframe"], ["src"]);
}
```

- [ ] **Step 4: Add fetch helpers (fetchText, fetchJson, tmdbUrl)**

```typescript
// Add after parsing helpers in src/desi-serials-to/desi-serials-to.ts

async function fetchText(url: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: headers || {} });
    if (!response || !response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response || !response.ok) {
    const status = response ? response.status : "unknown";
    throw new Error(`TMDB request failed: ${status}`);
  }
  return await response.json();
}

function tmdbUrl(path: string, apiKey: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return TMDB_BASE + path + separator + "api_key=" + encodeURIComponent(apiKey);
}
```

- [ ] **Step 5: Add fetchEpisodeMetadata (TMDB lookup)**

```typescript
// Add after fetch helpers in src/desi-serials-to/desi-serials-to.ts

export async function fetchEpisodeMetadata(
  tmdbId: string,
  mediaType: string,
  season: number,
  episode: number,
): Promise<EpisodeMetadata> {
  if (mediaType !== "tv") {
    throw new Error("Desi-Serials.to supports tv episodes only");
  }

  const tvInfo = await fetchJson(tmdbUrl(`/tv/${tmdbId}`, TMDB_API_KEY));
  const ep = await fetchJson(
    tmdbUrl(`/tv/${tmdbId}/season/${season}/episode/${episode}`, TMDB_API_KEY),
  );

  const title = tvInfo.name || tvInfo.original_name || "";
  const networkCandidates = channelSlugCandidates(
    (tvInfo.networks || []).map((n: any) => n.name),
  );
  const fallbackChannelSlugs = dedupe(Object.values(CHANNEL_SLUGS).flat());

  return {
    title,
    mediaType,
    season,
    episode,
    airDate: ep.air_date || "",
    episodeTitle: ep.name || "",
    networkCandidates,
    runtimeMinutes:
      Number(ep.runtime || (tvInfo.episode_run_time && tvInfo.episode_run_time[0]) || 0) || null,
    slugCandidates: buildTitleSlugCandidates(title, season),
    fallbackChannelSlugs,
  };
}
```

- [ ] **Step 6: Add buildArchivePageUrls (archive URL candidates)**

```typescript
// Add after fetchEpisodeMetadata in src/desi-serials-to/desi-serials-to.ts

function buildArchivePageUrls(metadata: EpisodeMetadata): string[] {
  const channels =
    metadata.networkCandidates.length > 0
      ? metadata.networkCandidates
      : metadata.fallbackChannelSlugs;
  const urls: string[] = [];
  for (const channel of channels) {
    for (const slug of metadata.slugCandidates) {
      urls.push(`https://www.desi-serials.to/watch-online/${channel}/${slug}/`);
      urls.push(`https://www.desi-serials.to/watch-online/${channel}/${slug}/page/2/`);
      urls.push(`https://www.desi-serials.to/watch-online/${channel}/${slug}/page/3/`);
    }
  }
  return dedupe(urls);
}
```

- [ ] **Step 7: Add findEpisodePageLinks and extractTvarticlesLinks**

```typescript
// Add after buildArchivePageUrls in src/desi-serials-to/desi-serials-to.ts

function findEpisodePageLinks(markup: string, metadata: EpisodeMetadata): string[] {
  const dateSlug = episodeDateSlug(metadata.airDate);
  if (!dateSlug) return [];
  return dedupe(
    extractLinks(markup).filter((href) => {
      if (!DESI_SERIALS_HOST_RE.test(href)) return false;
      if (!href.toLowerCase().includes(dateSlug)) return false;
      return (metadata.slugCandidates || []).some((slug) =>
        href.toLowerCase().includes(slug),
      );
    }),
  );
}

function extractTvarticlesLinks(markup: string): string[] {
  return dedupe(
    extractLinks(markup).filter((href) => TVARTICLES_RE.test(href)),
  );
}
```

- [ ] **Step 8: Add resolveTvarticlesPage (single tvarticles.org page → Stream | null)**

This fetches a single tvarticles.org/vidd.php page, extracts the iframe, classifies it,
and calls the appropriate resolver. Returns null on any failure.

```typescript
// Add after extractTvarticlesLinks in src/desi-serials-to/desi-serials-to.ts

async function resolveTvarticlesPage(tvarticlesUrl: string): Promise<Stream | null> {
  const page = await fetchText(tvarticlesUrl, BROWSER_HEADERS);
  if (!page) return null;

  const iframeUrl = extractIframes(page).find(
    (url) => resolverForIframe(url) !== null,
  );
  if (!iframeUrl) return null;

  const entry = resolverForIframe(iframeUrl);
  if (!entry) return null;

  const stream = await entry.resolve(iframeUrl, tvarticlesUrl);
  if (!stream || isPlaceholderUrl(stream.url)) return null;

  return stream;
}
```

- [ ] **Step 9: Add resolveDesiSerials (orchestrator with parallel fan-out)**

This is the main pipeline. It crawls archive pages sequentially to find the episode page,
collects all tvarticles links, then resolves them ALL in parallel via Promise.all.

```typescript
// Add after resolveTvarticlesPage in src/desi-serials-to/desi-serials-to.ts

export async function resolveDesiSerials(metadata: EpisodeMetadata): Promise<Stream[]> {
  const archiveUrls = buildArchivePageUrls(metadata);

  // Crawl archive pages sequentially until we find the episode page
  for (const archiveUrl of archiveUrls) {
    const archive = await fetchText(archiveUrl, BROWSER_HEADERS);
    if (!archive) continue;

    const episodeUrls = findEpisodePageLinks(archive, metadata);
    if (episodeUrls.length === 0) continue;

    // Fetch all episode pages, collect all tvarticles links
    const episodePages = await Promise.all(
      episodeUrls.map((url) => fetchText(url, BROWSER_HEADERS)),
    );
    const allTvarticlesUrls = dedupe(
      episodePages.flatMap((page) => (page ? extractTvarticlesLinks(page) : [])),
    );
    if (allTvarticlesUrls.length === 0) continue;

    // Resolve ALL tvarticles links in parallel
    const resolved = await Promise.all(
      allTvarticlesUrls.map((url) => resolveTvarticlesPage(url)),
    );

    // Filter nulls and deduplicate by stream URL
    const seen = new Set<string>();
    const streams: Stream[] = [];
    for (const stream of resolved) {
      if (!stream || seen.has(stream.url)) continue;
      seen.add(stream.url);
      streams.push(stream);
    }

    if (streams.length > 0) return streams;
  }

  return [];
}
```

- [ ] **Step 10: Verify typecheck passes**

Run: `cd /home/djraval/workspace/anupama-feed && npx tsc --noEmit`
Expected: No errors. If errors about missing `../shared/players` exports, verify Task 2 was completed.

- [ ] **Step 11: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add src/desi-serials-to/desi-serials-to.ts
git commit -m "feat: add desi-serials-to site logic with parallel tvarticles resolution"
```

---

## Task 4: Create index.ts (Nuvio entry point)

**Files:**
- Create: `src/desi-serials-to/index.ts`

This is the Nuvio contract — the `getStreams` function that Nuvio calls. It maps the
internal `Stream` type to the `NuvioStream` shape Nuvio expects.

- [ ] **Step 1: Create src/desi-serials-to/index.ts**

```typescript
// Desi-Serials.to Nuvio provider entry point.

import { Stream } from "../shared/players";
import { EpisodeMetadata, fetchEpisodeMetadata, resolveDesiSerials } from "./desi-serials-to";

export interface NuvioStream {
  name: string;
  title: string;
  url: string;
  quality: string;
  size: string;
  headers: Record<string, string>;
}

function displayBackend(backend: string): string {
  return String(backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, (_match, prefix, ch) => prefix + ch.toUpperCase())
    .replace(/[-_]+/g, "");
}

function episodeLabel(metadata: EpisodeMetadata): string {
  const season = String(metadata.season || 0).padStart(2, "0");
  const episode = String(metadata.episode || 0).padStart(2, "0");
  const parts = [`${metadata.title} S${season}E${episode}`];
  const epTitle = String(metadata.episodeTitle || "").trim();
  if (epTitle && !new RegExp(`^episode\\s+${metadata.episode}$`, "i").test(epTitle)) {
    parts.push(epTitle);
  }
  if (metadata.runtimeMinutes) {
    parts.push(`${metadata.runtimeMinutes}m`);
  }
  return parts.join(" - ");
}

function toNuvioStream(metadata: EpisodeMetadata, stream: Stream): NuvioStream {
  return {
    name: `Desi-Serials.to ${displayBackend(stream.backend)}`,
    title: `${episodeLabel(metadata)} - ${stream.quality} ${String(stream.kind || "stream").toUpperCase()}`,
    url: stream.url,
    quality: stream.quality,
    size: stream.size || "",
    headers: stream.headers || {},
  };
}

export async function getStreams(
  tmdbId: string,
  mediaType: string,
  season: number,
  episode: number,
): Promise<NuvioStream[]> {
  if (mediaType !== "tv") return [];

  try {
    const metadata = await fetchEpisodeMetadata(tmdbId, mediaType, season, episode);
    const streams = await resolveDesiSerials(metadata);
    return streams.map((s) => toNuvioStream(metadata, s));
  } catch (error: any) {
    console.log(`[Desi-Serials.to] getStreams failed: ${error.message}`);
    return [];
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /home/djraval/workspace/anupama-feed && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Build the provider**

Run: `cd /home/djraval/workspace/anupama-feed && node build.js`
Expected: "Building 1 provider(s)... Built desi-serials-to.js (XX.X KB) ... Done! 1 built, 0 failed"

- [ ] **Step 4: Verify the built file has the correct exports**

Run: `cd /home/djraval/workspace/anupama-feed && node -e "const m = require('./providers/desi-serials-to.js'); console.log(typeof m.getStreams)"`
Expected: `function`

- [ ] **Step 5: Verify the built file has no async/await (transpiled to generators)**

Run: `cd /home/djraval/workspace/anupama-feed && grep -c "async " providers/desi-serials-to.js && grep -c "await " providers/desi-serials-to.js`
Expected: `0` for both (async/await transpiled away by esbuild targeting ES2016).

- [ ] **Step 6: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add src/desi-serials-to/index.ts providers/desi-serials-to.js
git commit -m "feat: add Nuvio entry point and build desi-serials-to provider"
```

---

## Task 5: Update manifest.json, README.md, and delete old file

**Files:**
- Modify: `manifest.json`
- Modify: `README.md`
- Delete: `providers/desi-serials-to.js` (the OLD hand-edited one — it will be replaced by the build output from Task 4)

Note: The old `providers/desi-serials-to.js` was already replaced by the build output in Task 4.
This task updates the metadata files and verifies everything is consistent.

- [ ] **Step 1: Update manifest.json description and version**

Read the current manifest.json and update the description to mention the new capabilities:

```json
{
  "name": "Media Streams Scraper",
  "version": "2.0.0",
  "scrapers": [
    {
      "id": "desi-serials-to",
      "name": "Desi-Serials.to",
      "description": "Indian TV serial resolver using desi-serials.to with VkPrime, VkSpeed, and Flow player support.",
      "version": "2.0.0",
      "author": "djraval",
      "supportedTypes": ["tv"],
      "filename": "providers/desi-serials-to.js?v=2",
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

- [ ] **Step 2: Update README.md**

```markdown
# Media Streams Scraper

Nuvio scrapers for Indian TV streaming sites. Currently supports `desi-serials.to`.

## Setup

Add the repo manifest URL in Nuvio → Settings → Local Scrapers:
`https://raw.githubusercontent.com/djraval/Media-Streams-Scraper/main/manifest.json`

## Development

Source files live in `src/`. The built provider files in `providers/` are generated by esbuild.

```bash
npm install          # install esbuild + typescript
npm run build        # build all providers
npm run typecheck    # type-check without emitting
npm run build:watch  # rebuild on save
```

### Adding a new scraper

1. Create `src/<site-name>/index.ts` (entry point exporting `getStreams`)
2. Create `src/<site-name>/<site-name>.ts` (site logic)
3. Import shared player resolvers from `../shared/players` if needed
4. Add the scraper to `manifest.json`
5. Run `npm run build`
```

- [ ] **Step 3: Verify build still works after manifest update**

Run: `cd /home/djraval/workspace/anupama-feed && node build.js`
Expected: Builds successfully.

- [ ] **Step 4: Verify typecheck still passes**

Run: `cd /home/djraval/workspace/anupama-feed && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add manifest.json README.md
git commit -m "docs: update manifest and README for v2 multi-provider structure"
```

---

## Task 6: Functional verification

**Files:**
- None (verification only)

This task verifies the built scraper actually works by calling `getStreams` with a known
TMDB ID for Anupamaa and checking that streams are returned.

- [ ] **Step 1: Find the TMDB ID for Anupamaa**

Run:
```bash
cd /home/djraval/workspace/anupama-feed
curl -s "https://api.themoviedb.org/3/search/tv?api_key=4e1899804b6db6d01db1e59391e8a5fe&query=Anupamaa" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.results?.[0]?.id)"
```
Expected: A numeric TMDB ID (likely 154521 or similar).

- [ ] **Step 2: Run getStreams for a recent Anupamaa episode**

Create a temporary test script and run it:

```bash
cd /home/djraval/workspace/anupama-feed
node -e "
const { getStreams } = require('./providers/desi-serials-to.js');
getStreams('TMDB_ID', 'tv', 1, 1).then(streams => {
  console.log('Streams found:', streams.length);
  streams.forEach(s => console.log(JSON.stringify(s, null, 2)));
}).catch(e => console.error('Error:', e.message));
"
```

Replace `TMDB_ID` with the ID from Step 1. Use season/episode that has aired recently
(check desi-serials.to for available episodes).

Expected: 1-2 streams returned (one HLS from flow, possibly one MP4 from vkprime/vkspeed
if content is available and not a placeholder).

- [ ] **Step 3: Verify no placeholder URLs in output**

Check that none of the returned stream URLs contain `/ads/` or `127.0.0.1`:

```bash
cd /home/djraval/workspace/anupama-feed
node -e "
const { getStreams } = require('./providers/desi-serials-to.js');
getStreams('TMDB_ID', 'tv', 1, 1).then(streams => {
  const placeholders = streams.filter(s => s.url.includes('/ads/') || s.url.includes('127.0.0.1'));
  console.log('Placeholder streams:', placeholders.length);
  if (placeholders.length > 0) {
    console.log('FAIL: placeholders not filtered');
    process.exit(1);
  }
  console.log('PASS: no placeholders');
});
"
```

- [ ] **Step 4: Verify deduplication works (no duplicate URLs)**

```bash
cd /home/djraval/workspace/anupama-feed
node -e "
const { getStreams } = require('./providers/desi-serials-to.js');
getStreams('TMDB_ID', 'tv', 1, 1).then(streams => {
  const urls = streams.map(s => s.url);
  const unique = new Set(urls);
  if (urls.length !== unique.size) {
    console.log('FAIL: duplicate URLs found', urls);
    process.exit(1);
  }
  console.log('PASS: all URLs unique');
});
"
```

- [ ] **Step 5: Clean up any temp files and commit final state**

```bash
cd /home/djraval/workspace/anupama-feed
git status
# If there are any uncommitted changes:
git add -A && git commit -m "chore: final verification complete"
```

---

## Summary of behavioral changes

| Before | After |
|--------|-------|
| Single 633-line JS file, Promise chains | TypeScript source tree, async/await, esbuild bundling |
| Only resolves first matching vkprime or flow iframe | Resolves all 5 tvarticles links in parallel via Promise.all |
| No vkspeed.com support | `resolveVkPlayerEmbed` handles both vkprime + vkspeed |
| `seenBackends` stops at one vkprime + one flow | Dedup by stream URL only |
| No placeholder detection | `isPlaceholderUrl` filters `/ads/` and `127.0.0.1` |
| Flow embed020A (JuicyCodes) silently fails | `decodeJuicyCodes` extracts m3u8 from base64+packer |
| No type safety | TypeScript strict mode + tsc --noEmit |
| No build step | `npm run build` via esbuild |
