# vidup-desi + dramavideo-desi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new TV-only Nuvio providers that resolve Indian daily soap episodes via vidup.site (Blogger video → googlevideo MP4) and dramavideo.se (AES-CBC encrypted HLS).

**Architecture:** Two new resolvers in `src/lib/` (vidup.js, dramavideo.js) plus two provider entry points (vidup-desi, dramavideo-desi). Both follow the existing Layer 0-6 scraping pattern, reuse existing `src/lib/` modules (http.js, html.js, tmdb.js, format.js), and use Promise chains (no async/await — QuickJS sandbox constraint).

**Tech Stack:** ES modules → esbuild CJS bundle, crypto.subtle (Web Crypto API) for AES-CBC, fetch() for HTTP, Blogger batchexecute RPC API for vidup.site.

**Spec:** `docs/superpowers/specs/2026-07-11-vidup-dramavideo-providers-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/vidup.js` | Create | vidup.site embed → Blogger token → batchexecute API → MP4 URLs |
| `src/lib/dramavideo.js` | Create | dramavideo.se/watch → player.dramavideo.se → AES-CBC decrypt → HLS URL |
| `src/lib/html.js` | Modify | Add `data-litespeed-src` to `iframeSrcCandidates` |
| `src/lib/filemoon.js` | Modify | Export `bytesToString`, `base64UrlToBytes`, `concatBytes` for reuse |
| `src/vidup-desi/index.js` | Create | Provider: yodesionline.net + desiserialonline.su → vidup.js |
| `src/dramavideo-desi/index.js` | Create | Provider: yehrishtakiakehlatahai.com → dramavideo.js |
| `manifest.json` | Modify | Add 2 new scraper entries, bump version to 2.8.0 |
| `package.json` | Modify | Bump version to 2.8.0 |
| `test-all-providers.js` | Modify | Add vidup-desi + dramavideo-desi to test suite |

---

## Task 1: Add `data-litespeed-src` to iframe extraction

**Files:**
- Modify: `src/lib/html.js:135-144`

The dramavideo.se embed URL on yehrishtakiakehlatahai.com is in a `data-litespeed-src` attribute (LiteSpeed Cache plugin). The existing `iframeSrcCandidates` function doesn't include this attribute.

- [ ] **Step 1: Add `data-litespeed-src` to the attribute list**

Edit `src/lib/html.js`, find the `iframeSrcCandidates` function (line 135):

```javascript
export function iframeSrcCandidates(markup) {
  return dedupe(
    attrValues(markup, ["iframe"], [
      "src",
      "data-src",
      "data-wpfc-original-src",
      "data-lazy-src",
    ]),
  );
}
```

Change to:

```javascript
export function iframeSrcCandidates(markup) {
  return dedupe(
    attrValues(markup, ["iframe"], [
      "src",
      "data-src",
      "data-wpfc-original-src",
      "data-lazy-src",
      "data-litespeed-src",
    ]),
  );
}
```

- [ ] **Step 2: Verify the change doesn't break existing providers**

Run: `node build.js && for f in providers/*.js; do node -c "$f"; done && echo "OK"`
Expected: All providers build and syntax-check pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/html.js
git commit -m "feat: add data-litespeed-src to iframeSrcCandidates for LiteSpeed Cache sites"
```

---

## Task 2: Export crypto helpers from filemoon.js

**Files:**
- Modify: `src/lib/filemoon.js:16-60`

The dramavideo.js resolver needs `bytesToString`, `base64UrlToBytes`, and `concatBytes` for AES-CBC decryption via crypto.subtle. These already exist in filemoon.js but are not exported.

- [ ] **Step 1: Add export keywords to the three helper functions**

Edit `src/lib/filemoon.js`. Find these three function definitions and add `export`:

Line 17 — change:
```javascript
function base64UrlToBytes(str) {
```
to:
```javascript
export function base64UrlToBytes(str) {
```

Line 44 — change:
```javascript
function bytesToString(bytes) {
```
to:
```javascript
export function bytesToString(bytes) {
```

Line 55 — change:
```javascript
function concatBytes(a, b) {
```
to:
```javascript
export function concatBytes(a, b) {
```

- [ ] **Step 2: Verify build still works**

Run: `node build.js && for f in providers/*.js; do node -c "$f"; done && echo "OK"`
Expected: All providers build and syntax-check pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/filemoon.js
git commit -m "refactor: export bytesToString, base64UrlToBytes, concatBytes from filemoon.js"
```

---

## Task 3: Create the vidup.js resolver

**Files:**
- Create: `src/lib/vidup.js`

This resolver takes a vidup.site embed URL and returns MP4 streams from Blogger video (googlevideo.com).

- [ ] **Step 1: Create `src/lib/vidup.js` with the full implementation**

```javascript
// VidUp resolver — vidup.site embed → Blogger video → googlevideo MP4 URLs.
// Flow:
// 1. Fetch vidup.site/play?cd=... page
// 2. Extract Blogger token from blogger.com/video.g?token=... iframe
// 3. POST to Blogger batchexecute API (RPC ID: WcwnYd)
// 4. Parse response for googlevideo MP4 URLs (itag 18=360p, 22=720p)
//
// googlevideo URLs are IP-bound (same as Flow HLS) — no server-side probing.

import { UA, BROWSER_HEADERS } from "./constants.js";
import { fetchText } from "./http.js";

var VIDUP_HOSTS = ["vidup.site"];
var BLOGGER_BATCH_URL = "https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute";
var BLOGGER_RPC_ID = "WcwnYd";

// Itag → quality mapping for Blogger/googlevideo streams.
var ITAG_QUALITY = {
  18: "360p",
  22: "720p",
};

// Check if a URL is a vidup.site embed URL.
export function isVidUpUrl(url) {
  var str = String(url || "");
  for (var i = 0; i < VIDUP_HOSTS.length; i++) {
    if (str.indexOf(VIDUP_HOSTS[i]) !== -1) return true;
  }
  return false;
}

// Extract the Blogger video token from a vidup.site page HTML.
// The page contains an iframe: blogger.com/video.g?token=TOKEN
function extractBloggerToken(html) {
  var match = String(html || "").match(/blogger\.com\/video\.g\?token=([^"&]+)/);
  return match ? match[1] : "";
}

// Call the Blogger batchexecute API and return the raw response text.
// The API returns a response prefixed with )]}' XSS guard, then the JSON payload.
function bloggerBatchExecute(fetchImpl, token) {
  // Body: f.req=[[["WcwnYd","[\"TOKEN\"]",null,"generic"]]]
  var innerParam = '["' + token + '"]';
  var reqPayload = JSON.stringify([[BLOGGER_RPC_ID, innerParam, null, "generic"]]);
  var body = "f.req=" + encodeURIComponent(reqPayload);

  return fetchImpl(BLOGGER_BATCH_URL, {
    method: "POST",
    headers: Object.assign({}, BROWSER_HEADERS, {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "https://www.blogger.com/video.g",
      "X-Same-Domain": "1",
    }),
    body: body,
  })
    .then(function (response) {
      if (!response || response.ok === false) return null;
      return response.text();
    })
    .catch(function () { return null; });
}

// Parse the batchexecute response and extract googlevideo MP4 URLs.
// Returns: [{url, itag, quality}] sorted by quality descending.
function parseBloggerVideoUrls(responseText) {
  var text = String(responseText || "");
  if (!text) return [];

  // Decode \u003d → =, \u0026 → & etc.
  text = text.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
  text = text.replace(/\\u003f/g, "?").replace(/\\u002f/g, "/");

  // Extract all googlevideo URLs with their itag values
  var urlRe = /https:\/\/rr\d+---sn-[a-z0-9]+\.googlevideo\.com\/videoplayback[^"]+/g;
  var itagRe = /itag=(\d+)/;
  var results = [];
  var match;
  while ((match = urlRe.exec(text)) !== null) {
    var url = match[0];
    var itagMatch = url.match(itagRe);
    var itag = itagMatch ? Number(itagMatch[1]) : 0;
    var quality = ITAG_QUALITY[itag] || "unknown";
    results.push({ url: url, itag: itag, quality: quality });
  }

  // Dedupe by URL and sort by itag descending (720p first)
  var seen = new Set();
  var deduped = [];
  for (var i = 0; i < results.length; i++) {
    if (!seen.has(results[i].url)) {
      seen.add(results[i].url);
      deduped.push(results[i]);
    }
  }
  deduped.sort(function (a, b) { return b.itag - a.itag; });
  return deduped;
}

// Resolve a vidup.site embed URL to Blogger video MP4 streams.
// Returns: Promise<Array<{url, quality, name, kind, sourceTag}>>
export function resolveVidUpEmbed(fetchImpl, vidupUrl) {
  // Step 1: Fetch vidup.site page to get Blogger token
  return fetchText(fetchImpl, vidupUrl, { headers: BROWSER_HEADERS })
    .then(function (html) {
      if (!html) return [];
      var token = extractBloggerToken(html);
      if (!token) return [];

      // Step 2: Call batchexecute API
      return bloggerBatchExecute(fetchImpl, token);
    })
    .then(function (responseText) {
      if (!responseText) return [];

      // Step 3: Parse response for googlevideo URLs
      var urls = parseBloggerVideoUrls(responseText);
      return urls.map(function (item) {
        return {
          url: item.url,
          quality: item.quality,
          name: "Blogger",
          kind: "mp4",
          sourceTag: "blogger",
        };
      });
    })
    .catch(function () { return []; });
}
```

- [ ] **Step 2: Verify it builds**

Run: `node build.js && node -c providers/desi-serials-to.js && echo "OK"`
Expected: Build succeeds (vidup.js isn't used by any provider yet, but esbuild should still bundle fine).

- [ ] **Step 3: Quick manual test of the resolver**

Run:
```bash
node -e "
var fetchImpl = (typeof fetch !== 'undefined' ? fetch : require('http'));
// Use Node 18+ built-in fetch
var { resolveVidUpEmbed } = require('./src/lib/vidup.js');
"
```

If that fails (ES module import issue), test via a temporary provider:
```bash
node -e "
global.fetch = require('http'); // won't work — use node 18+
"
```

Skip if Node version < 18. The resolver will be tested in Task 5 via the full provider.

- [ ] **Step 4: Commit**

```bash
git add src/lib/vidup.js
git commit -m "feat: add vidup.js resolver — vidup.site → Blogger video → googlevideo MP4"
```

---

## Task 4: Create the dramavideo.js resolver

**Files:**
- Create: `src/lib/dramavideo.js`

This resolver takes a dramavideo.se/watch?v=... URL and returns HLS streams after AES-CBC decryption.

- [ ] **Step 1: Create `src/lib/dramavideo.js` with the full implementation**

```javascript
// DramaVideo resolver — dramavideo.se/watch → player.dramavideo.se → AES-CBC decrypt → HLS.
// Flow:
// 1. Fetch dramavideo.se/watch?v=... page
// 2. Extract data-video and data-provider from <li class="linkserver">
// 3. Fetch player.dramavideo.se/?id=...&sv=... WITH Referer header (404 without it)
// 4. Extract encData (base64), keyHex, ivHex from inline JS
// 5. AES-CBC decrypt via crypto.subtle (primary) or crypto-js (fallback)
// 6. Parse decrypted HTML for JSON.parse(`[{file, type, label}]`) → HLS URL
//
// HLS stream requires Referer: https://player.dramavideo.se/ for playback.

import { UA, BROWSER_HEADERS } from "./constants.js";
import { fetchText } from "./http.js";
import { bytesToString, base64UrlToBytes } from "./filemoon.js";

var DRAMAVIDEO_WATCH_RE = /dramavideo\.se\/watch\?v=(\d+)/i;
var PLAYER_HOST = "https://player.dramavideo.se/";
var PLAYER_REFERER = "https://dramavideo.se/";

// Check if a URL is a dramavideo.se/watch URL.
export function isDramavideoUrl(url) {
  return DRAMAVIDEO_WATCH_RE.test(String(url || ""));
}

// Extract the watch?v= ID from a dramavideo.se URL.
function extractWatchId(url) {
  var match = String(url || "").match(DRAMAVIDEO_WATCH_RE);
  return match ? match[1] : "";
}

// Extract data-video and data-provider from the dramavideo.se/watch page.
// The page has: <li class="linkserver" data-provider="v3" data-video="CODE">
function extractServerAttrs(html) {
  var text = String(html || "");
  var liMatch = text.match(/<li[^>]*class="linkserver"[^>]*>/i);
  if (!liMatch) return null;
  var liTag = liMatch[0];
  var videoMatch = liTag.match(/data-video="([^"]+)"/);
  var providerMatch = liTag.match(/data-provider="([^"]+)"/);
  if (!videoMatch || !providerMatch) return null;
  return { videoId: videoMatch[1], provider: providerMatch[1] };
}

// Hex string → Uint8Array (for crypto.subtle key/IV).
function hexToBytes(hex) {
  var str = String(hex || "");
  var bytes = [];
  for (var i = 0; i < str.length; i += 2) {
    bytes.push(parseInt(str.substr(i, 2), 16));
  }
  return new Uint8Array(bytes);
}

// Base64 → Uint8Array (standard base64, not base64url).
function base64ToBytes(b64) {
  // Convert to base64url format and reuse the filemoon helper
  var b64url = String(b64 || "").replace(/\+/g, "-").replace(/\//g, "_");
  return base64UrlToBytes(b64url);
}

// AES-CBC decrypt via crypto.subtle (Web Crypto API).
// Returns Promise<string> — the decrypted plaintext.
function aesCbcDecryptSubtle(encDataBase64, keyHex, ivHex) {
  var subtle = (typeof crypto !== "undefined" && crypto.subtle) ||
    (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle);
  if (!subtle) return Promise.reject(new Error("crypto.subtle not available"));

  var keyBytes = hexToBytes(keyHex);
  var ivBytes = hexToBytes(ivHex);
  var ctBytes = base64ToBytes(encDataBase64);

  return subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"])
    .then(function (key) {
      return subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, ctBytes);
    })
    .then(function (decrypted) {
      return bytesToString(new Uint8Array(decrypted));
    });
}

// AES-CBC decrypt via crypto-js (fallback if crypto.subtle unavailable).
function aesCbcDecryptCryptoJS(encDataBase64, keyHex, ivHex) {
  var CryptoJS = (typeof require === "function") ? require("crypto-js") : null;
  if (!CryptoJS) return Promise.reject(new Error("crypto-js not available"));

  var key = CryptoJS.enc.Hex.parse(keyHex);
  var iv = CryptoJS.enc.Hex.parse(ivHex);
  var cipherParams = CryptoJS.lib.CipherParams.create({
    ciphertext: CryptoJS.enc.Base64.parse(encDataBase64),
  });
  var decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return Promise.resolve(decrypted.toString(CryptoJS.enc.Utf8));
}

// AES-CBC decrypt — tries crypto.subtle first, falls back to crypto-js.
function aesCbcDecrypt(encDataBase64, keyHex, ivHex) {
  return aesCbcDecryptSubtle(encDataBase64, keyHex, ivHex).catch(function () {
    return aesCbcDecryptCryptoJS(encDataBase64, keyHex, ivHex);
  });
}

// Parse decrypted HTML for video sources.
// The decrypted HTML contains: JSON.parse(`[{file, type, label}]`)
// Returns: [{file, type, label}]
function parseDecryptedSources(html) {
  var text = String(html || "");
  var match = text.match(/JSON\.parse\(`(\[[^\]]+\])`\)/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return [];
  }
}

// Fetch and decrypt the player page.
// Returns Promise<string> — the decrypted HTML.
function decryptPlayerPage(fetchImpl, videoId, provider) {
  var playerUrl = PLAYER_HOST + "?id=" + videoId + "&sv=" + provider;
  var headers = Object.assign({}, BROWSER_HEADERS, { Referer: PLAYER_REFERER });

  return fetchText(fetchImpl, playerUrl, { headers: headers })
    .then(function (html) {
      if (!html) return null;
      var encMatch = html.match(/encData="([^"]+)"/);
      var keyMatch = html.match(/keyHex="([^"]+)"/);
      var ivMatch = html.match(/ivHex="([^"]+)"/);
      if (!encMatch || !keyMatch || !ivMatch) return null;
      return aesCbcDecrypt(encMatch[1], keyMatch[1], ivMatch[1]);
    });
}

// Resolve a dramavideo.se/watch?v=... URL to HLS streams.
// Returns: Promise<Array<{url, quality, name, kind, sourceTag, headers}>>
export function resolveDramavideoEmbed(fetchImpl, watchUrl) {
  var watchId = extractWatchId(watchUrl);
  if (!watchId) return Promise.resolve([]);

  // Step 1: Fetch dramavideo.se/watch?v=... page
  return fetchText(fetchImpl, watchUrl, { headers: BROWSER_HEADERS })
    .then(function (html) {
      if (!html) return [];
      var attrs = extractServerAttrs(html);
      if (!attrs) return [];

      // Step 2: Fetch and decrypt player page
      return decryptPlayerPage(fetchImpl, attrs.videoId, attrs.provider);
    })
    .then(function (decryptedHtml) {
      if (!decryptedHtml) return [];

      // Step 3: Parse sources
      var sources = parseDecryptedSources(decryptedHtml);
      return sources
        .filter(function (s) { return s.file && s.type === "hls"; })
        .map(function (s) {
          var qualityMatch = (s.label || "").match(/(\d{3,4})p?/i);
          var quality = qualityMatch ? qualityMatch[1] + "p" : "720p";
          return {
            url: s.file,
            quality: quality,
            name: "DramaVideo",
            kind: "hls",
            sourceTag: "dramavideo",
            headers: { Referer: PLAYER_HOST },
          };
        });
    })
    .catch(function () { return []; });
}
```

- [ ] **Step 2: Verify it builds**

Run: `node build.js && for f in providers/*.js; do node -c "$f"; done && echo "OK"`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dramavideo.js
git commit -m "feat: add dramavideo.js resolver — AES-CBC decrypt → HLS stream"
```

---

## Task 5: Create the vidup-desi provider

**Files:**
- Create: `src/vidup-desi/index.js`

This provider searches yodesionline.net and desiserialonline.su for episode pages, extracts vidup.site iframes, and resolves them via vidup.js.

- [ ] **Step 1: Create `src/vidup-desi/index.js`**

```javascript
// VidUp Desi Nuvio provider — resolves Indian TV episodes from
// yodesionline.net and desiserialonline.su via vidup.site (Blogger video) player.
//
// Both sites use WordPress with date-based episode URLs:
//   yodesionline.net:      /{slug}-{date}-full-episode-{num}/
//   desiserialonline.su:   /{slug}-{date}-video-episode-{num}/
//
// The date format is "11th-july-2026" (produced by episodeDateSlug).

import { UA, BROWSER_HEADERS, TMDB_API_KEY } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchFirstResult } from "../lib/http.js";
import { iframeSrcCandidates, dedupe, dedupeStreams } from "../lib/html.js";
import { buildMediaRequest, slugCandidates, episodeDateSlug } from "../lib/tmdb.js";
import { toNuvioStream } from "../lib/format.js";
import { resolveVidUpEmbed, isVidUpUrl } from "../lib/vidup.js";

// ---------------------------------------------------------------------------
// Layer 0: Configuration
// ---------------------------------------------------------------------------

var SITES = [
  {
    base: "https://yodesionline.net",
    episodePatterns: [
      "/{slug}-{date}-full-episode-{num}/",
    ],
  },
  {
    base: "https://desiserialonline.su",
    episodePatterns: [
      "/{slug}-{date}-video-episode-{num}/",
    ],
  },
];

// WordPress search path for fallback when air date is missing.
var SEARCH_PATH = "/?s=";

// ---------------------------------------------------------------------------
// Layer 2: Episode page URL construction
// ---------------------------------------------------------------------------

// Build candidate episode URLs for a given site, slug, date, and episode number.
function buildEpisodeUrls(site, slugCandidates, dateSlug, episodeNum) {
  var urls = [];
  for (var s = 0; s < slugCandidates.length; s++) {
    for (var p = 0; p < site.episodePatterns.length; p++) {
      var path = site.episodePatterns[p]
        .replace("{slug}", slugCandidates[s])
        .replace("{date}", dateSlug)
        .replace("{num}", episodeNum);
      urls.push(site.base + path);
    }
  }
  return urls;
}

// Build all candidate URLs across all sites.
function buildAllEpisodeUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) return [];

  var allUrls = [];
  for (var i = 0; i < SITES.length; i++) {
    var siteUrls = buildEpisodeUrls(SITES[i], request.slugCandidates, dateSlug, request.episode);
    allUrls = allUrls.concat(siteUrls);
  }
  return allUrls;
}

// Build WordPress search URLs as fallback.
function buildSearchUrls(request) {
  var urls = [];
  var query = encodeURIComponent(request.title + " episode " + request.episode);
  for (var i = 0; i < SITES.length; i++) {
    urls.push(SITES[i].base + SEARCH_PATH + query);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Layer 3: Embed URL extraction
// ---------------------------------------------------------------------------

// Extract vidup.site iframe URLs from an episode page HTML.
function extractVidUpEmbeds(html) {
  var candidates = iframeSrcCandidates(html);
  return dedupe(candidates.filter(isVidUpUrl));
}

// Find episode links from a WordPress search results page.
function extractEpisodeLinks(html, episodeNum) {
  var linkRe = /href="(https?:\/\/[^"]+\/[^"]*episode[^"]*)"/gi;
  var match;
  var urls = [];
  while ((match = linkRe.exec(String(html || ""))) !== null) {
    var url = match[1];
    // Match episode number in the URL
    if (url.match(new RegExp("episode-" + episodeNum + "\\b"))) {
      urls.push(url);
    }
  }
  return dedupe(urls);
}

// ---------------------------------------------------------------------------
// Layer 4: Player resolution
// ---------------------------------------------------------------------------

// Resolve all vidup.site embeds from an episode page.
function resolveVidUpFromPage(fetchImpl, pageUrl) {
  return fetchText(fetchImpl, pageUrl, { headers: BROWSER_HEADERS })
    .then(function (html) {
      if (!html) return [];
      var embeds = extractVidUpEmbeds(html);
      if (embeds.length === 0) return [];

      // Resolve all embeds in parallel
      return Promise.all(embeds.map(function (embedUrl) {
        return resolveVidUpEmbed(fetchImpl, embedUrl);
      })).then(function (results) {
        var all = [];
        for (var i = 0; i < results.length; i++) {
          all = all.concat(results[i]);
        }
        return all;
      });
    });
}

// ---------------------------------------------------------------------------
// Layer 5 + 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);

  // Try date-based URL construction first
  var urls = buildAllEpisodeUrls(request);

  function tryUrls(urlList) {
    return fetchFirstResult(fetchImpl, urlList, { headers: BROWSER_HEADERS }, function (html, url) {
      var embeds = extractVidUpEmbeds(html);
      if (embeds.length === 0) return null;
      return { url: url, embeds: embeds };
    });
  }

  return tryUrls(urls)
    .then(function (page) {
      if (page) {
        // Resolve all embeds from the found page
        return Promise.all(page.embeds.map(function (embedUrl) {
          return resolveVidUpEmbed(fetchImpl, embedUrl);
        })).then(function (results) {
          var all = [];
          for (var i = 0; i < results.length; i++) {
            all = all.concat(results[i]);
          }
          return all;
        });
      }

      // Fallback: WordPress search
      var searchUrls = buildSearchUrls(request);
      return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function (html) {
        var episodeLinks = extractEpisodeLinks(html, request.episode);
        return episodeLinks.length > 0 ? episodeLinks : null;
      }).then(function (links) {
        if (!links || links.length === 0) return [];
        return fetchFirstResult(fetchImpl, links, { headers: BROWSER_HEADERS }, function (html) {
          var embeds = extractVidUpEmbeds(html);
          return embeds.length > 0 ? embeds : null;
        }).then(function (embeds) {
          if (!embeds) return [];
          return Promise.all(embeds.map(function (embedUrl) {
            return resolveVidUpEmbed(fetchImpl, embedUrl);
          })).then(function (results) {
            var all = [];
            for (var i = 0; i < results.length; i++) {
              all = all.concat(results[i]);
            }
            return all;
          });
        });
      });
    })
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "VidUp Desi";
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[VidUp Desi] resolver failed: " + error.message);
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[VidUp Desi] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
```

- [ ] **Step 2: Build the provider**

Run: `node build.js vidup-desi`
Expected: `Built vidup-desi.js (XX KB)`

- [ ] **Step 3: Syntax check**

Run: `node -c providers/vidup-desi.js && echo "OK"`
Expected: OK

- [ ] **Step 4: Test with Anupamaa episode 2072**

Run:
```bash
node -e "var p = require('./providers/vidup-desi.js'); p.getStreams('116479', 'tv', 1, 2072).then(function(s) { console.log(s.length + ' streams'); s.forEach(function(x) { console.log('  ' + x.quality + ' ' + x.name + ' ' + x.url.substring(0, 80)); }); }).catch(function(e) { console.log('ERROR: ' + e.message); });"
```
Expected: 1-2 streams with "Blogger" name and googlevideo.com URLs. Note: URLs are IP-bound and may 403 from server, but the resolver should still return them.

- [ ] **Step 5: Commit**

```bash
git add src/vidup-desi/index.js providers/vidup-desi.js
git commit -m "feat: add vidup-desi provider — yodesionline.net + desiserialonline.su via vidup.site"
```

---

## Task 6: Create the dramavideo-desi provider

**Files:**
- Create: `src/dramavideo-desi/index.js`

This provider searches yehrishtakiakehlatahai.com for episode pages, extracts dramavideo.se/watch iframes, and resolves them via dramavideo.js.

- [ ] **Step 1: Create `src/dramavideo-desi/index.js`**

```javascript
// DramaVideo Desi Nuvio provider — resolves Indian TV episodes from
// yehrishtakiakehlatahai.com via dramavideo.se (AES-CBC encrypted HLS) player.
//
// Episode URL pattern: /{slug}-{date}-episode-{num}-video/
// The date format is "16th-june-2026" (produced by episodeDateSlug).

import { UA, BROWSER_HEADERS, TMDB_API_KEY } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchFirstResult } from "../lib/http.js";
import { iframeSrcCandidates, dedupe, dedupeStreams } from "../lib/html.js";
import { buildMediaRequest, slugCandidates, episodeDateSlug } from "../lib/tmdb.js";
import { toNuvioStream } from "../lib/format.js";
import { resolveDramavideoEmbed, isDramavideoUrl } from "../lib/dramavideo.js";

// ---------------------------------------------------------------------------
// Layer 0: Configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://yehrishtakiakehlatahai.com";
var EPISODE_PATTERN = "/{slug}-{date}-episode-{num}-video/";
var SEARCH_PATH = "/?s=";

// ---------------------------------------------------------------------------
// Layer 2: Episode page URL construction
// ---------------------------------------------------------------------------

// Build candidate episode URLs using date-based construction.
function buildEpisodeUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) return [];

  var urls = [];
  for (var i = 0; i < request.slugCandidates.length; i++) {
    var path = EPISODE_PATTERN
      .replace("{slug}", request.slugCandidates[i])
      .replace("{date}", dateSlug)
      .replace("{num}", request.episode);
    urls.push(SITE_BASE + path);
  }
  return urls;
}

// Build WordPress search URL as fallback.
function buildSearchUrl(request) {
  var query = encodeURIComponent(request.title + " episode " + request.episode);
  return SITE_BASE + SEARCH_PATH + query;
}

// ---------------------------------------------------------------------------
// Layer 3: Embed URL extraction
// ---------------------------------------------------------------------------

// Extract dramavideo.se/watch iframe URLs from an episode page HTML.
function extractDramavideoEmbeds(html) {
  var candidates = iframeSrcCandidates(html);
  // Also check for data-litespeed-src in raw HTML (already in iframeSrcCandidates)
  return dedupe(candidates.filter(isDramavideoUrl));
}

// Find episode links from a WordPress search results page.
function extractEpisodeLinks(html, episodeNum) {
  var linkRe = /href="(https?:\/\/yehrishtakiakehlatahai\.com\/[^"]*episode[^"]*)"/gi;
  var match;
  var urls = [];
  while ((match = linkRe.exec(String(html || ""))) !== null) {
    var url = match[1];
    if (url.match(new RegExp("episode-" + episodeNum + "\\b"))) {
      urls.push(url);
    }
  }
  return dedupe(urls);
}

// ---------------------------------------------------------------------------
// Layer 4: Player resolution
// ---------------------------------------------------------------------------

// Resolve all dramavideo.se embeds from an episode page.
function resolveDramavideoFromPage(fetchImpl, pageUrl) {
  return fetchText(fetchImpl, pageUrl, { headers: BROWSER_HEADERS })
    .then(function (html) {
      if (!html) return [];
      var embeds = extractDramavideoEmbeds(html);
      if (embeds.length === 0) return [];

      return Promise.all(embeds.map(function (embedUrl) {
        return resolveDramavideoEmbed(fetchImpl, embedUrl);
      })).then(function (results) {
        var all = [];
        for (var i = 0; i < results.length; i++) {
          all = all.concat(results[i]);
        }
        return all;
      });
    });
}

// ---------------------------------------------------------------------------
// Layer 5 + 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);

  // Try date-based URL construction first
  var urls = buildEpisodeUrls(request);

  return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (html, url) {
    var embeds = extractDramavideoEmbeds(html);
    if (embeds.length === 0) return null;
    return { url: url, embeds: embeds };
  })
    .then(function (page) {
      if (page) {
        return Promise.all(page.embeds.map(function (embedUrl) {
          return resolveDramavideoEmbed(fetchImpl, embedUrl);
        })).then(function (results) {
          var all = [];
          for (var i = 0; i < results.length; i++) {
            all = all.concat(results[i]);
          }
          return all;
        });
      }

      // Fallback: WordPress search
      var searchUrl = buildSearchUrl(request);
      return fetchText(fetchImpl, searchUrl, { headers: BROWSER_HEADERS })
        .then(function (html) {
          if (!html) return [];
          var episodeLinks = extractEpisodeLinks(html, request.episode);
          if (episodeLinks.length === 0) return [];

          return fetchFirstResult(fetchImpl, episodeLinks, { headers: BROWSER_HEADERS }, function (epHtml) {
            var embeds = extractDramavideoEmbeds(epHtml);
            return embeds.length > 0 ? embeds : null;
          }).then(function (embeds) {
            if (!embeds) return [];
            return Promise.all(embeds.map(function (embedUrl) {
              return resolveDramavideoEmbed(fetchImpl, embedUrl);
            })).then(function (results) {
              var all = [];
              for (var i = 0; i < results.length; i++) {
                all = all.concat(results[i]);
              }
              return all;
            });
          });
        });
    })
    .then(function (resolved) {
      return dedupeStreams(resolved).map(function (stream) {
        stream.name = "DramaVideo Desi";
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[DramaVideo Desi] resolver failed: " + error.message);
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[DramaVideo Desi] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
```

- [ ] **Step 2: Build the provider**

Run: `node build.js dramavideo-desi`
Expected: `Built dramavideo-desi.js (XX KB)`

- [ ] **Step 3: Syntax check**

Run: `node -c providers/dramavideo-desi.js && echo "OK"`
Expected: OK

- [ ] **Step 4: Test with Anupamaa episode 2046**

Run:
```bash
node -e "var p = require('./providers/dramavideo-desi.js'); p.getStreams('116479', 'tv', 1, 2046).then(function(s) { console.log(s.length + ' streams'); s.forEach(function(x) { console.log('  ' + x.quality + ' ' + x.name + ' ' + x.url.substring(0, 80)); }); }).catch(function(e) { console.log('ERROR: ' + e.message); });"
```
Expected: 1 stream with "DramaVideo Desi" name and hls.dramavideo.se URL, quality "720p".

- [ ] **Step 5: Test with Yeh Rishta Kya Kehlata Hai**

Run:
```bash
node -e "var p = require('./providers/dramavideo-desi.js'); p.getStreams('16413', 'tv', 1, 5186).then(function(s) { console.log(s.length + ' streams'); s.forEach(function(x) { console.log('  ' + x.quality + ' ' + x.name + ' ' + x.url.substring(0, 80)); }); }).catch(function(e) { console.log('ERROR: ' + e.message); });"
```
Expected: 1 stream with hls.dramavideo.se URL.

- [ ] **Step 6: Commit**

```bash
git add src/dramavideo-desi/index.js providers/dramavideo-desi.js
git commit -m "feat: add dramavideo-desi provider — yehrishtakiakehlatahai.com via dramavideo.se"
```

---

## Task 7: Update manifest.json and package.json

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`

- [ ] **Step 1: Add the two new scraper entries to manifest.json**

Edit `manifest.json`. Add these two entries to the `scrapers` array (after the streamwish-heymovies entry, before the closing `]`):

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
      "logo": "",
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
      "logo": "",
      "contentLanguage": ["hi", "en"],
      "formats": ["hls"],
      "limited": true,
      "disabledPlatforms": [],
      "supportsExternalPlayer": true
    }
```

Also update the top-level version from `2.7.1` to `2.8.0` and update all existing scrapers' version fields from `2.7.1` to `2.8.0` and their `filename` `?v=` params from `2.7.1` to `2.8.0`.

- [ ] **Step 2: Bump package.json version**

Edit `package.json`, change `"version": "2.7.1"` to `"version": "2.8.0"`.

- [ ] **Step 3: Verify manifest is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 4: Commit**

```bash
git add manifest.json package.json
git commit -m "chore: bump to v2.8.0, add vidup-desi + dramavideo-desi to manifest"
```

---

## Task 8: Update test-all-providers.js

**Files:**
- Modify: `test-all-providers.js`

- [ ] **Step 1: Add the new providers to the test script**

Edit `test-all-providers.js`. Add to the `providers` object (line 4-12):

```javascript
  'vidup-desi': require('./providers/vidup-desi.js'),
  'dramavideo-desi': require('./providers/dramavideo-desi.js'),
```

Add `'vidup-desi'` and `'dramavideo-desi'` to the `tvProviders` array (line 43):

```javascript
var tvProviders = ['desi-serials-to', 'desitvserials-se', 'desiruleztv-net', 'mixdrop-desi', 'streamtape-desi', 'vidup-desi', 'dramavideo-desi'];
```

- [ ] **Step 2: Run the full test suite**

Run: `node test-all-providers.js`
Expected: vidup-desi and dramavideo-desi should appear in the results. vidup-desi may show streams with googlevideo URLs (IP-bound, won't play server-side). dramavideo-desi should show HLS streams.

- [ ] **Step 3: Commit**

```bash
git add test-all-providers.js
git commit -m "test: add vidup-desi + dramavideo-desi to test-all-providers.js"
```

---

## Task 9: Final build verification and cleanup

- [ ] **Step 1: Full build of all providers**

Run: `node build.js`
Expected: All 9 providers build successfully (7 existing + 2 new).

- [ ] **Step 2: Syntax check all built files**

Run: `for f in providers/*.js; do node -c "$f" && echo "$f OK"; done`
Expected: All files pass syntax check.

- [ ] **Step 3: Remove playwright from dependencies (if it was only for testing)**

Check if playwright is still needed:
Run: `grep -r "playwright" src/ test-*.js 2>/dev/null`
If no results (other than the earlier test scripts we cleaned up), remove it from package.json:
```bash
npm uninstall playwright
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final build verification for v2.8.0"
```

---

## Self-Review Checklist

### Spec coverage
- [x] vidup.site → Blogger video resolver → `src/lib/vidup.js` (Task 3)
- [x] dramavideo.se AES-CBC decrypt → `src/lib/dramavideo.js` (Task 4)
- [x] vidup-desi provider (yodesionline.net + desiserialonline.su) → Task 5
- [x] dramavideo-desi provider (yehrishtakiakehlatahai.com) → Task 6
- [x] Manifest entries → Task 7
- [x] data-litespeed-src iframe extraction → Task 1
- [x] crypto.subtle primary + crypto-js fallback → Task 4
- [x] bytesToString reuse from filemoon.js → Task 2
- [x] IP-bound URL handling (no probing) → Task 3 (vidup.js returns URLs without probing)
- [x] Referer header for player.dramavideo.se → Task 4 (dramavideo.js)
- [x] Referer header for HLS playback → Task 4 (headers field in stream object)
- [x] Date-based URL construction with episodeDateSlug → Tasks 5, 6
- [x] WordPress search fallback → Tasks 5, 6
- [x] Testing plan → Tasks 5, 6, 8

### Placeholder scan
- No TBD/TODO/"implement later" found
- All code blocks contain complete implementations
- All test commands have expected outputs

### Type consistency
- `resolveVidUpEmbed` returns `Promise<Array<{url, quality, name, kind, sourceTag}>>` — consistent across vidup.js and vidup-desi/index.js
- `resolveDramavideoEmbed` returns `Promise<Array<{url, quality, name, kind, sourceTag, headers}>>` — consistent across dramavideo.js and dramavideo-desi/index.js
- `isVidUpUrl` and `isDramavideoUrl` are exported and used consistently
- `bytesToString`, `base64UrlToBytes` exported from filemoon.js and imported in dramavideo.js
