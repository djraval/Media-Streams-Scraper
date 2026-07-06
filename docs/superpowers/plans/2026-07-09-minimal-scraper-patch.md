# Minimal Scraper Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 4 behavioral bugs in the existing single-file scraper: add VkSpeed support, resolve all 5 tvarticles links in parallel, filter placeholder videos, and fix JuicyCodes decode for Flow embed020A.

**Architecture:** Patch `providers/desi-serials-to.js` directly. No build step, no TypeScript, no new files. The file stays as a single hand-edited JS file using Promise chains (Hermes-compatible).

**Spec:** `docs/superpowers/specs/2026-07-09-ts-multi-provider-refactor-design.md` (behavioral requirements still apply; the implementation approach changed from TS refactor to minimal patch per code review)

---

## What changes in the existing file

| Location | Current | New |
|---------|---------|-----|
| After `FLOW_RE` const | (missing) | Add `VKSPEED_RE` regex |
| After regex constants | (missing) | Add `isPlaceholderUrl(url)` function |
| After `unpack` function | (missing) | Add `decodeBase64(raw)` helper (Hermes-safe, no atob dependency) |
| After `decodeBase64` | (missing) | Add `decodeJuicyCodes(html)` function |
| `firstIframe()` function | Only matches VKPRIME_RE + FLOW_RE | `findPlayerIframe()` matches VKPRIME_RE + VKSPEED_RE + FLOW_RE |
| `resolveVkprimePlayer()` function | Hardcoded backend "vkprime", no placeholder filtering | `resolveVkPlayer()` — backend from host, filters placeholders before ranking |
| `resolveFlowPlayer()` function | Only scans direct m3u8, misses JuicyCodes | Tries direct m3u8 first, then JuicyCodes decode |
| `resolveTvarticlePage()` function | Dispatches to vkprime or flow | `resolveTvarticlesPage()` — dispatches to vkPlayer or flow, wraps in catch |
| `resolveDesiSerials()` function | Sequential `processViddUrls`, `seenBackends` dedup | `Promise.all` for all tvarticles links, dedup by URL only |
| `manifest.json` | `?v=1` | `?v=2` |

### What does NOT change

- All constants (TMDB, UA, headers, MONTHS, CHANNEL_SLUGS, DESI_SERIALS_HOST_RE, TVARTICLES_RE, VKPRIME_RE, FLOW_RE)
- All parsing helpers (dedupe, decodeText, mediaCandidates, mp4Candidates, m3u8Candidates, attrValues, links, iframes, packerEncode, unpack, formatBytes)
- All slug/date helpers (normalizeTitle, slugCandidates, requestSlugCandidates, channelSlugCandidates, episodeDateSlug)
- TMDB lookup (fetchJson, tmdbUrl, buildMediaRequest, buildCandidateUrls, fetchText)
- Episode page parsing (episodePageCandidates, tvarticlesLinks)
- Quality helpers (qualityNearUrl, rankedMp4Candidates, hlsQualityFromManifest, mp4QualityLabel, fetchContentLength)
- Nuvio output (displayBackend, episodeLabel, toNuvioStream, getStreamsForRequest, getStreams)

---

## Task 1: Add VkSpeed regex + placeholder detection + JuicyCodes decoder

**Files:**
- Modify: `providers/desi-serials-to.js`

This task adds the 4 new building blocks that the rest of the patch depends on.

- [ ] **Step 1: Add VKSPEED_RE after FLOW_RE**

Find the line `const FLOW_RE = /^https:\/\/flow\.tvlogy\.to\/[A-Za-z0-9/_-]+\/?$/i;` and insert after it:

```javascript
const VKSPEED_RE = /^https:\/\/vkspeed\.com\/embed-[A-Za-z0-9-]+\.html$/i;
```

- [ ] **Step 2: Add isPlaceholderUrl after the regex constants**

Insert after `VKSPEED_RE`:

```javascript
function isPlaceholderUrl(url) {
  var lower = String(url || "").toLowerCase();
  return lower.indexOf("/ads/") !== -1 || lower.indexOf("127.0.0.1") !== -1;
}
```

- [ ] **Step 3: Add decodeBase64 after the unpack function**

Find the closing brace of the `unpack` function (the function that matches `eval(function(p,a,c,k,e,`) and insert after it:

```javascript
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(raw) {
  var input = String(raw || "").replace(/[^A-Za-z0-9+/]/g, "");
  var output = "";
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < input.length; i++) {
    var idx = B64_CHARS.indexOf(input.charAt(i));
    if (idx === -1) { continue; }
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

- [ ] **Step 4: Add decodeJuicyCodes after decodeBase64**

JuicyCodes wraps a p,a,c,k packer in base64. The payload is split across multiple
string literals concatenated with `+`. We extract all quoted fragments (both single
and double quoted), concatenate, base64-decode, then run `unpack`.

```javascript
function decodeJuicyCodes(html) {
  var match = String(html || "").match(/JuicyCodes\.Run\(([^)]+)\)/s);
  if (!match) { return ""; }
  var fragments = match[1].match(/"([^"]*)"|'([^']*)'/g);
  if (!fragments) { return ""; }
  var payload = "";
  for (var i = 0; i < fragments.length; i++) {
    payload += fragments[i].replace(/^["']|["']$/g, "");
  }
  return unpack(decodeBase64(payload));
}
```

- [ ] **Step 5: Verify the file still parses**

Run: `cd /home/djraval/workspace/anupama-feed && node -e "require('./providers/desi-serials-to.js'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add providers/desi-serials-to.js
git commit -m "feat: add VkSpeed regex, placeholder detection, and JuicyCodes decoder"
```

---

## Task 2: Generalize resolveVkprimePlayer → resolveVkPlayer

**Files:**
- Modify: `providers/desi-serials-to.js` (lines 407-435)

VkPrime and VkSpeed have identical page structure. One function handles both — the
backend name is derived from the embed URL host. Placeholders are filtered BEFORE
ranking so a placeholder ranked first doesn't discard a real candidate ranked second.

- [ ] **Step 1: Replace the resolveVkprimePlayer function with resolveVkPlayer**

Find the function `function resolveVkprimePlayer(embedUrl, refererUrl, options) {` and replace the entire function (from its `function` line to its closing `}`) with:

```javascript
function resolveVkPlayer(embedUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  return fetchText(fetchImpl, embedUrl, {
    headers: Object.assign({}, BROWSER_HEADERS, { Referer: refererUrl }),
  })
    .then(function (player) {
      if (!player) {
        return null;
      }
      var payload = [player, unpack(player)].filter(Boolean).join("\n");
      var ranked = rankedMp4Candidates(payload);
      if (ranked.length === 0) {
        return null;
      }
      // Filter out placeholder URLs before picking the best quality.
      // A placeholder ranked first should not discard a real candidate ranked second.
      var real = ranked.filter(function (entry) { return !isPlaceholderUrl(entry.url); });
      if (real.length === 0) {
        return null;
      }
      var best = real[0];
      var headers = { Referer: embedUrl, "User-Agent": UA };
      var backend = embedUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime";
      return fetchContentLength(fetchImpl, best.url, headers).then(function (contentLength) {
        return {
          backend: backend,
          kind: "mp4",
          quality: mp4QualityLabel(best.quality),
          url: best.url,
          size: formatBytes(contentLength),
          headers: headers,
        };
      });
    });
}
```

- [ ] **Step 2: Verify the file still parses**

Run: `cd /home/djraval/workspace/anupama-feed && node -e "require('./providers/desi-serials-to.js'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add providers/desi-serials-to.js
git commit -m "feat: generalize resolveVkprimePlayer to resolveVkPlayer (handles vkprime + vkspeed)"
```

---

## Task 3: Fix resolveFlowPlayer to decode JuicyCodes

**Files:**
- Modify: `providers/desi-serials-to.js` (lines 437-464)

The current `resolveFlowPlayer` only scans for `.m3u8` URLs directly in the player HTML.
This works for `plyr020A` and `nflix020A` variants (which expose `sources` JSON directly)
but fails on `embed020A` (Flash Player), which wraps the player config in
`JuicyCodes.Run("base64...")`. The fix: try direct extraction first, then fall back to
JuicyCodes decode.

- [ ] **Step 1: Replace the resolveFlowPlayer function**

Find the function `function resolveFlowPlayer(playerUrl, refererUrl, options) {` and replace the entire function (from its `function` line to its closing `}`) with:

```javascript
function resolveFlowPlayer(playerUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  return fetchText(fetchImpl, playerUrl, {
    headers: Object.assign({}, BROWSER_HEADERS, { Referer: refererUrl }),
  })
    .then(function (player) {
      if (!player) {
        return null;
      }
      // Try direct m3u8 extraction first (works for plyr020A, nflix020A variants).
      var masterUrl = m3u8Candidates(player)[0] || "";
      // Fall back to JuicyCodes decode (needed for embed020A / Flash Player variant).
      if (!masterUrl) {
        var decoded = decodeJuicyCodes(player);
        masterUrl = m3u8Candidates(decoded)[0] || "";
      }
      if (!masterUrl) {
        return null;
      }
      return fetchText(fetchImpl, masterUrl, {
        headers: Object.assign({}, BROWSER_HEADERS, { Referer: playerUrl }),
      }).then(function (manifest) {
        return {
          backend: "flow",
          kind: "hls",
          quality: hlsQualityFromManifest(manifest),
          url: masterUrl,
          size: "",
          headers: { Referer: playerUrl, "User-Agent": UA },
        };
      });
    });
}
```

- [ ] **Step 2: Verify the file still parses**

Run: `cd /home/djraval/workspace/anupama-feed && node -e "require('./providers/desi-serials-to.js'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add providers/desi-serials-to.js
git commit -m "fix: decode JuicyCodes obfuscation in Flow embed020A player pages"
```

---

## Task 4: Update iframe finder + tvarticles page resolver

**Files:**
- Modify: `providers/desi-serials-to.js` (lines 349-353, 466-486)

Update `firstIframe` to also match VkSpeed iframes. Rename to `findPlayerIframe` for
clarity. Update `resolveTvarticlePage` to dispatch to `resolveVkPlayer` (not the old
`resolveVkprimePlayer`), accept VkSpeed iframes, and wrap in a catch so one bad link
never blocks the others.

- [ ] **Step 1: Replace the firstIframe function with findPlayerIframe**

Find the function `function firstIframe(markup) {` and replace the entire function with:

```javascript
function findPlayerIframe(markup) {
  return iframes(markup).find(function (href) {
    return VKPRIME_RE.test(href) || VKSPEED_RE.test(href) || FLOW_RE.test(href);
  }) || "";
}
```

- [ ] **Step 2: Replace the resolveTvarticlePage function with resolveTvarticlesPage**

Find the function `function resolveTvarticlePage(viddUrl, options) {` and replace the entire function (from its `function` line to its closing `}`) with:

```javascript
function resolveTvarticlesPage(tvarticlesUrl, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  return fetchText(fetchImpl, tvarticlesUrl, { headers: BROWSER_HEADERS })
    .then(function (page) {
      if (!page) {
        return null;
      }
      var iframeUrl = findPlayerIframe(page);
      if (!iframeUrl) {
        return null;
      }
      if (VKPRIME_RE.test(iframeUrl) || VKSPEED_RE.test(iframeUrl)) {
        return resolveVkPlayer(iframeUrl, tvarticlesUrl, { fetchImpl: fetchImpl });
      }
      if (FLOW_RE.test(iframeUrl)) {
        return resolveFlowPlayer(iframeUrl, tvarticlesUrl, { fetchImpl: fetchImpl });
      }
      return null;
    })
    .catch(function () { return null; });
}
```

- [ ] **Step 3: Verify the file still parses**

Run: `cd /home/djraval/workspace/anupama-feed && node -e "require('./providers/desi-serials-to.js'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add providers/desi-serials-to.js
git commit -m "feat: update iframe finder for VkSpeed + add error isolation to page resolver"
```

---

## Task 5: Replace sequential processViddUrls with parallel Promise.all

**Files:**
- Modify: `providers/desi-serials-to.js` (lines 488-560)

This is the core behavioral change. The current code resolves tvarticles links
sequentially and stops at one stream per backend type (`seenBackends`). The new code
resolves ALL tvarticles links in parallel via `Promise.all` and deduplicates only by
stream URL — so you can get both an MP4 and an HLS stream from the same episode.

- [ ] **Step 1: Replace resolveDesiSerials**

Replace the entire `resolveDesiSerials` function (from `function resolveDesiSerials(request, options) {` through its closing `}`, including all inner functions `processArchive`, `processEpisodes`, `processViddUrls`) with:

```javascript
function resolveDesiSerials(request, options) {
  options = options || {};
  var fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  var archiveUrls = buildCandidateUrls(request).desiSerials;

  function processArchive(index) {
    if (index >= archiveUrls.length) {
      return Promise.resolve([]);
    }
    return fetchText(fetchImpl, archiveUrls[index], { headers: BROWSER_HEADERS })
      .then(function (archive) {
        if (!archive) {
          return processArchive(index + 1);
        }
        var episodeUrls = episodePageCandidates(archive, request);
        if (episodeUrls.length === 0) {
          return processArchive(index + 1);
        }
        // Fetch all episode pages in parallel (null on failure, won't reject the batch).
        return Promise.all(
          episodeUrls.map(function (url) {
            return fetchText(fetchImpl, url, { headers: BROWSER_HEADERS })
              .catch(function () { return null; });
          })
        ).then(function (episodePages) {
          // Collect all tvarticles links from all episode pages.
          var allTvarticlesUrls = dedupe(
            episodePages.flatMap(function (page) {
              return page ? tvarticlesLinks(page) : [];
            })
          );
          if (allTvarticlesUrls.length === 0) {
            return processArchive(index + 1);
          }
          // Resolve ALL tvarticles links in parallel.
          // resolveTvarticlesPage has its own .catch(), so a single failure
          // returns null instead of rejecting the whole Promise.all.
          return Promise.all(
            allTvarticlesUrls.map(function (url) {
              return resolveTvarticlesPage(url, { fetchImpl: fetchImpl });
            })
          ).then(function (resolved) {
            // Filter nulls and deduplicate by stream URL.
            var seen = new Set();
            var streams = [];
            for (var i = 0; i < resolved.length; i++) {
              var stream = resolved[i];
              if (stream && !seen.has(stream.url)) {
                seen.add(stream.url);
                streams.push(stream);
              }
            }
            if (streams.length > 0) {
              return streams;
            }
            return processArchive(index + 1);
          });
        });
      });
  }

  return processArchive(0);
}
```

Note: The episode-page fetch and tvarticles resolution are nested INSIDE the archive
fetch success branch. This ensures that `processArchive(index + 1)` recursive calls
return directly without flowing into `.then()` handlers that expect page HTML or
resolved streams. The previous flat-chain version had a bug where recursive fallback
results would be misinterpreted as episode page arrays or stream arrays.

Note: `flatMap` is available in the Hermes runtime — the current scraper already uses
`matchAll` (ES2020) and `padStart` (ES2017). `flatMap` is ES2019, which is safe.

- [ ] **Step 2: Verify the file still parses**

Run: `cd /home/djraval/workspace/anupama-feed && node -e "require('./providers/desi-serials-to.js'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Verify getStreams still works (dry run with mock TMDB ID)**

Run:
```bash
cd /home/djraval/workspace/anupama-feed
node -e "
var scraper = require('./providers/desi-serials-to.js');
scraper.getStreams('154521', 'tv', 3, 120).then(function(streams) {
  console.log('Streams found:', streams.length);
  streams.forEach(function(s) { console.log(JSON.stringify(s)); });
}).catch(function(e) { console.error('Error:', e.message); });
"
```

Note: `154521` is the TMDB ID for Anupamaa. Season 3, episode 120 is an example —
replace with any season/episode you know is on desi-serials.to. If you're unsure,
check the site for a recent episode URL and cross-reference the air date on TMDB.
This will make real network requests and may take 10-30 seconds. Expected: 0-2
streams. If it returns 0 streams, try a different season/episode before assuming
the scraper is broken.

- [ ] **Step 4: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add providers/desi-serials-to.js
git commit -m "feat: resolve all tvarticles links in parallel, dedup by stream URL only"
```

---

## Task 6: Update manifest.json version

**Files:**
- Modify: `manifest.json`

Bump version to force Nuvio to re-fetch the updated scraper file.

- [ ] **Step 1: Update manifest.json**

Change `"version": "1.0.0"` to `"version": "2.0.0"` in both the repo-level and scraper-level fields. Change `"filename": "providers/desi-serials-to.js?v=1"` to `"providers/desi-serials-to.js?v=2"`. Update the description to mention VkSpeed. Do NOT change the repo-level `"name"` field — keep it as the current value.

```json
{
  "name": "Desi-Serials Repo",
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

- [ ] **Step 2: Commit**

```bash
cd /home/djraval/workspace/anupama-feed
git add manifest.json
git commit -m "chore: bump manifest to v2 for cache refresh"
```

---

## Task 7: Functional verification

**Files:**
- None (verification only)

- [ ] **Step 1: Find TMDB ID for Anupamaa**

```bash
cd /home/djraval/workspace/anupama-feed
curl -s "https://api.themoviedb.org/3/search/tv?api_key=4e1899804b6db6d01db1e59391e8a5fe&query=Anupamaa" | node -e "var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.results && d.results[0] && d.results[0].id)"
```

- [ ] **Step 2: Run getStreams for a recent aired episode**

Replace `TMDB_ID` with the ID from step 1. Use a season/episode that has aired and
should be on desi-serials.to. Check the site for a recent episode URL first — for
example, if the site shows `anupamaa-episode-5th-july-2025-watch-online`, find the
corresponding season/episode numbers on TMDB. Use those numbers instead of `1, 1`.

```bash
cd /home/djraval/workspace/anupama-feed
node -e "
var scraper = require('./providers/desi-serials-to.js');
scraper.getStreams('TMDB_ID', 'tv', SEASON, EPISODE).then(function(streams) {
  console.log('Streams found:', streams.length);
  streams.forEach(function(s) { console.log(JSON.stringify(s, null, 2)); });
}).catch(function(e) { console.error('Error:', e.message); });
"
```

Expected: 1-2 streams (one HLS from flow, possibly one MP4 from vkprime/vkspeed
if content is available and not a placeholder).

- [ ] **Step 3: Verify no placeholder URLs in output**

```bash
cd /home/djraval/workspace/anupama-feed
node -e "
var scraper = require('./providers/desi-serials-to.js');
scraper.getStreams('TMDB_ID', 'tv', SEASON, EPISODE).then(function(streams) {
  var placeholders = streams.filter(function(s) {
    return s.url.indexOf('/ads/') !== -1 || s.url.indexOf('127.0.0.1') !== -1;
  });
  if (placeholders.length > 0) {
    console.log('FAIL: placeholders not filtered');
    placeholders.forEach(function(s) { console.log(s.url); });
    process.exit(1);
  }
  console.log('PASS: no placeholders in output');
}).catch(function(e) { console.error('Error:', e.message); });
"
```

- [ ] **Step 4: Verify no duplicate URLs**

```bash
cd /home/djraval/workspace/anupama-feed
node -e "
var scraper = require('./providers/desi-serials-to.js');
scraper.getStreams('TMDB_ID', 'tv', SEASON, EPISODE).then(function(streams) {
  var urls = streams.map(function(s) { return s.url; });
  var unique = new Set(urls);
  if (urls.length !== unique.size) {
    console.log('FAIL: duplicate URLs found');
    urls.forEach(function(u) { console.log(u); });
    process.exit(1);
  }
  console.log('PASS: all URLs unique');
}).catch(function(e) { console.error('Error:', e.message); });
"
```

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
cd /home/djraval/workspace/anupama-feed
git status
```

---

## Summary of behavioral changes

| Before | After |
|--------|-------|
| No vkspeed.com support | `VKSPEED_RE` + `resolveVkPlayer` handles both vkprime + vkspeed |
| Resolves tvarticles links sequentially, stops at first per backend | Resolves all 5 links in parallel via `Promise.all` |
| `seenBackends` dedup stops at one vkprime + one flow | Dedup by stream URL only — can return both MP4 and HLS |
| No placeholder detection | `isPlaceholderUrl` filters `/ads/` and `127.0.0.1` before ranking |
| Flow embed020A (JuicyCodes) silently fails | `decodeJuicyCodes` extracts m3u8 from base64+packer |
| One bad link can abort the whole resolution | `resolveTvarticlesPage` has `.catch(() => null)` for isolation |
