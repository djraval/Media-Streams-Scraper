# Nuvio Plugin Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the repo to a single hand-maintained Nuvio scraper file (`providers/desi-serials-to.js`) for `desi-serials.to`, with a hardcoded TMDB key, and delete all Python/build/test scaffolding.

**Architecture:** One JS file using Promise chains (Hermes-compatible, no async/await, no build step). Synchronous helpers port verbatim from the existing `desi-serials/src/common.js` and `request.js`. Async fetch chains rewritten from the existing `desi-serials/src/backends/desiserials.js` async/await into `.then()` chains. A single `getStreams(tmdbId, mediaType, season, episode)` entry point + dual `module.exports`/`global` export.

**Tech Stack:** Plain JavaScript (ES2016 target), native `fetch`, no dependencies, no build tooling.

**Spec:** `docs/superpowers/specs/2026-07-05-nuvio-plugin-cleanup-design.md`

**Note on testing:** The user explicitly opted out of automated tests. Verification is `node -c` (syntax) + `node -e` (module load) + manual Nuvio Plugin Tester / tailscale funnel smoke test. TDD steps are intentionally omitted per user instruction.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `providers/desi-serials-to.js` | Create | Single scraper file: constants, helpers, TMDB lookup, resolver, `getStreams`, exports |
| `manifest.json` | Rewrite | Point at `providers/desi-serials-to.js?v=1`, id `desi-serials-to`, no `hasSettings` |
| `README.md` | Rewrite | Nuvio-only install instructions |
| `.gitignore` | Simplify | Remove Python/Node entries, keep only what's relevant |
| `scraper.py`, `backends.py`, `test_scraper.py` | Delete | Legacy Python scraper |
| `__pycache__/`, `pw/` | Delete | Python artifacts |
| `desi-serials/` (entire tree) | Delete | Old multi-file JS plugin (superseded by `providers/desi-serials-to.js`) |
| `build.js`, `package.json`, `package-lock.json`, `node_modules/` | Delete | Build tooling (no build step) |
| `live-validation/` | Delete | Validation screenshots/frames |
| `docs/` | Delete (last) | Specs/plans dir — removed after the plan is executed |
| `src/` (empty root dir) | Delete | Empty |

The scraper file is built in 4 incremental edits (Tasks 1-4), each adding a logical section. The file only becomes loadable in Task 4 when `module.exports` is added. Tasks 5-7 handle manifest, README, deletions. Task 8 is final verification + cleanup of `docs/`.

---

### Task 1: Create scraper file with constants + synchronous helpers

**Files:**
- Create: `providers/desi-serials-to.js`

- [ ] **Step 1: Create the `providers/` directory**

Run: `mkdir -p providers`
Expected: directory created, no output.

- [ ] **Step 2: Create `providers/desi-serials-to.js` with constants + synchronous helpers**

This is the first section of the file. No `module.exports` yet — subsequent tasks add more code before the export. The synchronous helpers below are ported verbatim from `desi-serials/src/common.js` and `desi-serials/src/request.js` (pure functions, unchanged).

```javascript
// Desi-Serials.to Nuvio provider — single-file scraper.
// Resolves Indian TV episodes from desi-serials.to via VkPrime (MP4) and Flow (HLS) players.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe";

const UA = (
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
);
const BROWSER_HEADERS = { "User-Agent": UA };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const CHANNEL_SLUGS = {
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
];

const DESI_SERIALS_HOST_RE = /^https:\/\/www\.desi-serials\.to\//i;
const TVARTICLES_RE = /^https:\/\/tvarticles\.org\/vidd\.php\?id=\d+/i;
const VKPRIME_RE = /^https:\/\/vkprime\.com\/embed-[A-Za-z0-9-]+\.html$/i;
const FLOW_RE = /^https:\/\/flow\.tvlogy\.to\/[A-Za-z0-9/_-]+\/?$/i;

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function decodeText(raw) {
  let text = String(raw || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  const replacements = [
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

function englishOrd(n) {
  if (n % 100 >= 10 && n % 100 <= 20) {
    return `${n}th`;
  }
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}

function mediaCandidates(raw, extension) {
  const text = decodeText(raw);
  const pattern = new RegExp(
    "https?://[^\\s'\\\"<>\\\\,}\\]]+\\." +
      extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(?:\\?[^\\s'\\\"<>\\\\}\\]]*)?",
    "gi",
  );
  return dedupe(
    Array.from(text.matchAll(pattern), (match) => (
      match[0].replace(/[.;)]+$/g, "")
    )),
  );
}

function mp4Candidates(raw) {
  return mediaCandidates(raw, "mp4");
}

function m3u8Candidates(raw) {
  return mediaCandidates(raw, "m3u8");
}

function attrValues(markup, tags, attrs) {
  const tagAlternation = tags.join("|");
  const attrAlternation = attrs.join("|");
  const tagPattern = new RegExp(`<\\s*(${tagAlternation})\\b[^>]*>`, "gis");
  const attrPattern = new RegExp(
    `\\b(${attrAlternation})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const values = [];
  for (const tag of String(markup || "").matchAll(tagPattern)) {
    const attr = tag[0].match(attrPattern);
    if (attr) {
      values.push(decodeText((attr[2] || attr[3] || attr[4] || "").trim()));
    }
  }
  return dedupe(values);
}

function links(markup) {
  return attrValues(markup, ["a", "link", "area"], ["href"]);
}

function iframes(markup) {
  return attrValues(markup, ["iframe"], ["src"]);
}

function packerEncode(n, base) {
  if (n === 0) {
    return "0";
  }
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

function unpack(blob) {
  const match = String(blob || "").match(
    /eval\(function\(p,a,c,k,e,(?:d|r)\).*?\}\s*\(\s*'(?<p>.*?)'\s*,\s*(?<a>\d+)\s*,\s*(?<c>\d+)\s*,\s*'(?<k>.*?)'\.split\('\|'\)/s,
  );
  if (!match || !match.groups) {
    return "";
  }

  let out = match.groups.p.replace(/\\'/g, "'");
  const base = Number(match.groups.a);
  const count = Number(match.groups.c);
  const keys = match.groups.k.replace(/\\'/g, "'").split("|");

  for (let i = count - 1; i >= 0; i -= 1) {
    if (!keys[i]) {
      continue;
    }
    const token = packerEncode(i, base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${token}\\b`, "g"), keys[i]);
  }
  return out;
}

function juicycodesPayloads(raw) {
  const payloads = [];
  const callPattern = /JuicyCodes\.Run\((?<body>.*?)\)/gs;
  const stringPattern = /(['"])(.*?)(?<!\\)\1/gs;
  for (const call of String(raw || "").matchAll(callPattern)) {
    const parts = [];
    for (const segment of call.groups.body.matchAll(stringPattern)) {
      parts.push(segment[2]);
    }
    if (parts.length > 0) {
      payloads.push(parts.join(""));
    }
  }
  return dedupe(payloads);
}

function decodeBase64(payload) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(payload || "").replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const ch of clean) {
    if (ch === "=") {
      break;
    }
    const value = alphabet.indexOf(ch);
    if (value === -1) {
      return null;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(escape(out));
  } catch (_err) {
    return out;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

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

function normalizeTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugCandidates(title) {
  const base = normalizeTitle(title);
  if (!base) {
    return [];
  }
  const candidates = [base];
  if (base.includes("aa")) {
    candidates.push(base.replace(/aa/g, "a"));
  }
  return dedupe(candidates);
}

function requestSlugCandidates(title, season) {
  const candidates = slugCandidates(title);
  if (season > 1 && candidates.length > 0) {
    candidates.push(`${candidates[0]}-${season}`);
  }
  return dedupe(candidates);
}

function channelSlugCandidates(networks) {
  const candidates = [];
  for (const network of networks || []) {
    const key = String(network || "").trim().toLowerCase();
    if (CHANNEL_SLUGS[key]) {
      candidates.push(...CHANNEL_SLUGS[key]);
    }
  }
  return dedupe(candidates);
}

function episodeDateSlug(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  const day = Number(match[3]);
  return `${englishOrd(day).replace(/[a-z]+$/, "")}-${MONTHS[Number(match[2]) - 1]}-${match[1]}`;
}
```

Note: `episodeDateSlug` above produces e.g. `"2-july-2026"` (day without ordinal suffix). This matches the existing `desi-serials/src/backends/desiserials.js` `episodeDateSlug` behavior, which uses `${day}${suffix}-${month}-${year}` — but the suffix is part of the date-slug match in `episodePageCandidates`. **Correction:** the existing code keeps the ordinal suffix in the slug. Replace the `episodeDateSlug` body with the exact original:

```javascript
function episodeDateSlug(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  const day = Number(match[3]);
  const suffix = day % 100 >= 10 && day % 100 <= 20
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  const month = MONTHS[Number(match[2]) - 1];
  return `${day}${suffix}-${month}-${match[1]}`;
}
```

Use the corrected version with the ordinal suffix — it must match the date-slug format used in `desi-serials.to` URLs.

- [ ] **Step 3: Verify syntax**

Run: `node -c providers/desi-serials-to.js`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add providers/desi-serials-to.js
git commit -m "$(cat <<'EOF'
feat: add desi-serials-to scraper constants and helpers

First section of the single-file Nuvio scraper: TMDB key, browser
headers, channel slugs, host regexes, and synchronous helpers
(dedupe, decodeText, unpack, juicycodes, base64, slug candidates)
ported verbatim from the old multi-file plugin.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 2: Add TMDB + request building (Promise chains)

**Files:**
- Modify: `providers/desi-serials-to.js` (append before the eventual `module.exports`)

- [ ] **Step 1: Append TMDB and candidate-URL functions to the scraper file**

Append this block at the end of `providers/desi-serials-to.js` (after `episodeDateSlug`). These are Promise-based ports of `fetchJson`, `tmdbUrl`, `buildMediaRequest` from `desi-serials/src/request.js`, and `buildCandidateUrls` from the same file. `buildMediaRequest` is rewritten from async/await into a `.then()` chain.

```javascript
function fetchJson(fetchImpl, url) {
  return fetchImpl(url).then(function (response) {
    if (!response || response.ok === false) {
      const status = response ? response.status : "unknown";
      throw new Error("TMDB request failed: " + status);
    }
    return response.json();
  });
}

function tmdbUrl(path, tmdbApiKey) {
  const separator = path.includes("?") ? "&" : "?";
  return TMDB_BASE + path + separator + "api_key=" + encodeURIComponent(tmdbApiKey);
}

function buildMediaRequest(tmdbId, mediaType, season, episode, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const tmdbApiKey = options.tmdbApiKey;
  if (!tmdbApiKey) {
    return Promise.reject(new Error("TMDB API key is required"));
  }
  if (mediaType !== "tv") {
    return Promise.reject(new Error("Desi-Serials.to supports tv episodes only"));
  }
  const FALLBACK_CHANNEL_SLUGS = dedupe(Object.values(CHANNEL_SLUGS).flat());
  let tvInfo = null;
  return fetchJson(fetchImpl, tmdbUrl("/tv/" + tmdbId, tmdbApiKey))
    .then(function (tv) {
      tvInfo = tv;
      return fetchJson(
        fetchImpl,
        tmdbUrl("/tv/" + tmdbId + "/season/" + season + "/episode/" + episode, tmdbApiKey),
      );
    })
    .then(function (ep) {
      const title = tvInfo.name || tvInfo.original_name || "";
      const networkCandidates = channelSlugCandidates(
        (tvInfo.networks || []).map(function (network) { return network.name; }),
      );
      return {
        title: title,
        mediaType: mediaType,
        season: season,
        episode: episode,
        airDate: ep.air_date || "",
        episodeTitle: ep.name || "",
        firstAirDate: tvInfo.first_air_date || "",
        networkCandidates: networkCandidates,
        runtimeMinutes: Number(ep.runtime || (tvInfo.episode_run_time && tvInfo.episode_run_time[0]) || 0) || null,
        slugCandidates: requestSlugCandidates(title, season),
        fallbackChannelSlugs: FALLBACK_CHANNEL_SLUGS,
      };
    });
}

function buildCandidateUrls(request) {
  const channels = (request.networkCandidates && request.networkCandidates.length > 0)
    ? request.networkCandidates
    : request.fallbackChannelSlugs;
  const urls = [];
  for (const channel of channels) {
    for (const slug of request.slugCandidates || []) {
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/");
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/page/2/");
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/page/3/");
    }
  }
  return { desiSerials: dedupe(urls) };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c providers/desi-serials-to.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add providers/desi-serials-to.js
git commit -m "$(cat <<'EOF'
feat: add TMDB lookup and archive-URL builder

Promise-chain port of fetchJson, tmdbUrl, buildMediaRequest, and
buildCandidateUrls. buildMediaRequest fetches /tv/{id} and the
season/episode endpoints, then assembles the request object
(title, airDate, slugCandidates, channelCandidates) used by the
resolver to walk desi-serials.to archive pages.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 3: Add stream resolution (Promise chains)

**Files:**
- Modify: `providers/desi-serials-to.js` (append after `buildCandidateUrls`)

- [ ] **Step 1: Append fetch helpers, quality detection, and player resolvers**

Append this block. The synchronous helpers (`episodePageCandidates`, `tvarticlesLinks`, `firstIframe`, `qualityNearUrl`, `rankedMp4Candidates`, `hlsQualityFromManifest`, `hlsBandwidth`, `mp4QualityLabel`, `parsedDurationSeconds`, `durationSecondsFromRequest`, `estimatedHlsSize`) port verbatim from `desi-serials/src/backends/desiserials.js`. The async functions (`fetchText`, `fetchContentLength`, `resolveVkprimePlayer`, `resolveFlowPlayer`, `resolveTvarticlePage`, `resolveDesiSerials`) are rewritten from async/await into Promise chains.

```javascript
function fetchText(fetchImpl, url, options) {
  return fetchImpl(url, options || {})
    .then(function (response) {
      if (!response || response.ok === false) {
        return null;
      }
      return response.text();
    })
    .catch(function () { return null; });
}

function episodePageCandidates(markup, request) {
  const dateSlug = episodeDateSlug(request.airDate);
  if (!dateSlug) {
    return [];
  }
  return dedupe(
    links(markup).filter(function (href) {
      if (!DESI_SERIALS_HOST_RE.test(href)) {
        return false;
      }
      if (!href.toLowerCase().includes(dateSlug)) {
        return false;
      }
      return (request.slugCandidates || []).some(function (slug) {
        return href.toLowerCase().includes(slug);
      });
    }),
  );
}

function tvarticlesLinks(markup) {
  return dedupe(links(markup).filter(function (href) {
    return TVARTICLES_RE.test(href);
  }));
}

function firstIframe(markup) {
  return iframes(markup).find(function (href) {
    return VKPRIME_RE.test(href) || FLOW_RE.test(href);
  }) || "";
}

function qualityNearUrl(text, url) {
  const index = text.indexOf(url);
  if (index === -1) {
    return null;
  }
  const after = text.slice(index, index + url.length + 160);
  const afterMatch = after.match(/\b(?:label|quality|res|resolution)['"]?\s*[:=]\s*['"]?(\d{3,4})p?\b/i)
    || after.match(/\b(\d{3,4})p\b/i);
  if (afterMatch) {
    return Number(afterMatch[1]);
  }
  const before = text.slice(Math.max(0, index - 160), index);
  const matches = [
    ...before.matchAll(/\b(?:label|quality|res|resolution)['"]?\s*[:=]\s*['"]?(\d{3,4})p?\b/gi),
    ...before.matchAll(/\b(\d{3,4})p\b/gi),
  ];
  if (matches.length === 0) {
    return null;
  }
  return Number(matches[matches.length - 1][1]);
}

function rankedMp4Candidates(raw) {
  const text = decodeText(raw);
  return mp4Candidates(text)
    .map(function (url) { return { url: url, quality: qualityNearUrl(text, url) || 0 }; })
    .sort(function (a, b) { return b.quality - a.quality; });
}

function hlsQualityFromManifest(raw) {
  const match = String(raw || "").match(/RESOLUTION=\d+x(\d{3,4})/i);
  return match ? match[1] + "p" : "unknown";
}

function hlsBandwidth(raw) {
  const match = String(raw || "").match(/BANDWIDTH=(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function mp4QualityLabel(height) {
  if (!height) {
    return "unknown";
  }
  return height < 480 ? "unknown" : height + "p";
}

function parsedDurationSeconds(raw) {
  const match = String(raw || "").match(/\bduration['"]?\s*[:=]\s*['"]?(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) : 0;
}

function durationSecondsFromRequest(request) {
  const minutes = Number((request && request.runtimeMinutes) || 0);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : 0;
}

function estimatedHlsSize(bandwidthBitsPerSecond, durationSeconds) {
  if (!bandwidthBitsPerSecond || !durationSeconds) {
    return "";
  }
  return formatBytes((bandwidthBitsPerSecond * durationSeconds) / 8);
}

function fetchContentLength(fetchImpl, url, headers) {
  return fetchImpl(url, { method: "HEAD", headers: headers })
    .then(function (response) {
      if (!response || response.ok === false || !response.headers || typeof response.headers.get !== "function") {
        return 0;
      }
      return Number(response.headers.get("content-length") || 0) || 0;
    })
    .catch(function () { return 0; });
}

function resolveVkprimePlayer(embedUrl, refererUrl, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  return fetchText(fetchImpl, embedUrl, {
    headers: Object.assign({}, BROWSER_HEADERS, { Referer: refererUrl }),
  })
    .then(function (player) {
      if (!player) {
        return null;
      }
      const payload = [player, unpack(player)].filter(Boolean).join("\n");
      const ranked = rankedMp4Candidates(payload);
      if (ranked.length === 0) {
        return null;
      }
      const best = ranked[0];
      const headers = { Referer: embedUrl, "User-Agent": UA };
      return fetchContentLength(fetchImpl, best.url, headers).then(function (contentLength) {
        return {
          backend: "vkprime",
          kind: "mp4",
          quality: mp4QualityLabel(best.quality),
          url: best.url,
          size: formatBytes(contentLength),
          durationSeconds: parsedDurationSeconds(payload) || durationSecondsFromRequest(options.request),
          headers: headers,
        };
      });
    });
}

function resolveFlowPlayer(playerUrl, refererUrl, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  return fetchText(fetchImpl, playerUrl, {
    headers: Object.assign({}, BROWSER_HEADERS, { Referer: refererUrl }),
  })
    .then(function (player) {
      if (!player) {
        return null;
      }
      const masterUrl = m3u8Candidates(player)[0];
      if (!masterUrl) {
        return null;
      }
      return fetchText(fetchImpl, masterUrl, {
        headers: Object.assign({}, BROWSER_HEADERS, { Referer: playerUrl }),
      }).then(function (manifest) {
        const durationSeconds = durationSecondsFromRequest(options.request);
        return {
          backend: "flow",
          kind: "hls",
          quality: hlsQualityFromManifest(manifest),
          url: masterUrl,
          size: estimatedHlsSize(hlsBandwidth(manifest), durationSeconds),
          durationSeconds: durationSeconds,
          headers: { Referer: playerUrl, "User-Agent": UA },
        };
      });
    });
}

function resolveTvarticlePage(viddUrl, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  return fetchText(fetchImpl, viddUrl, { headers: BROWSER_HEADERS })
    .then(function (page) {
      if (!page) {
        return null;
      }
      const iframeUrl = firstIframe(page);
      if (!iframeUrl) {
        return null;
      }
      if (VKSPEED_RE.test(iframeUrl)) {
        return resolveVkprimePlayer(iframeUrl, viddUrl, { fetchImpl: fetchImpl, request: options.request });
      }
      if (FLOW_RE.test(iframeUrl)) {
        return resolveFlowPlayer(iframeUrl, viddUrl, { fetchImpl: fetchImpl, request: options.request });
      }
      return null;
    });
}
```

Note: `VKSPEED_RE` is referenced in `resolveTvarticlePage` but was not defined in Task 1 (only `VKPRIME_RE` was). Add it to the constants block. **Correction to apply:** edit the constants section to add:

```javascript
const VKSPEED_RE = /^https:\/\/vkprime\.com\/embed-[A-Za-z0-9-]+\.html$/i;
```

Wait — `VKPRIME_RE` and `VKSPEED_RE` would be identical. Re-check the original `desi-serials/src/backends/desiserials.js`: it only defines `VKPRIME_RE` and uses `VKPRIME_RE.test(iframeUrl)` in `resolveTvarticlePage`. The reference to `VKSPEED_RE` in the code block above is a transcription error. **Fix:** in `resolveTvarticlePage`, replace `VKSPEED_RE.test(iframeUrl)` with `VKPRIME_RE.test(iframeUrl)`. Do not add a new constant.

Apply the fix so `resolveTvarticlePage` reads:

```javascript
      if (VKPRIME_RE.test(iframeUrl)) {
        return resolveVkprimePlayer(iframeUrl, viddUrl, { fetchImpl: fetchImpl, request: options.request });
      }
      if (FLOW_RE.test(iframeUrl)) {
        return resolveFlowPlayer(iframeUrl, viddUrl, { fetchImpl: fetchImpl, request: options.request });
      }
```

- [ ] **Step 2: Verify syntax**

Run: `node -c providers/desi-serials-to.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add providers/desi-serials-to.js
git commit -m "$(cat <<'EOF'
feat: add vkprime/flow player resolvers as promise chains

Ports fetchText, fetchContentLength, episode/tvarticles/iframe
extraction, quality detection helpers, and the vkprime (MP4 via
unpack) and flow (HLS m3u8) player resolvers from the old async
backend into Promise chains for Hermes compatibility.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 4: Add resolveDesiSerials orchestrator + getStreams + exports

**Files:**
- Modify: `providers/desi-serials-to.js` (append after `resolveTvarticlePage`)

- [ ] **Step 1: Append the resolver orchestrator, stream mapping, and entry point**

`resolveDesiSerials` walks archive URLs → episode pages → tvarticles links → player resolvers, collecting and deduping streams. The original uses a `for...of` loop with sequential awaits; the Promise-chain version uses a recursive helper to process arrays sequentially. `getStreamsForRequest` maps backend streams to Nuvio stream objects. `getStreams` is the entry point Nuvio calls.

```javascript
function resolveDesiSerials(request, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const seenEpisodes = new Set();
  const seenBackends = new Set();
  const seenStreams = new Set();
  const streams = [];
  const archiveUrls = buildCandidateUrls(request).desiSerials;

  function processArchive(index) {
    if (index >= archiveUrls.length) {
      return Promise.resolve(streams);
    }
    return fetchText(fetchImpl, archiveUrls[index], { headers: BROWSER_HEADERS })
      .then(function (archive) {
        if (!archive) {
          return processArchive(index + 1);
        }
        const episodeUrls = episodePageCandidates(archive, request);
        return processEpisodes(episodeUrls, 0);
      })
      .then(function () {
        if (streams.length > 0) {
          streams.sort(function (left, right) {
            const leftRank = left.backend === "vkprime" ? -1 : 1;
            const rightRank = right.backend === "vkprime" ? -1 : 1;
            return leftRank - rightRank;
          });
          return streams;
        }
        return processArchive(index + 1);
      });
  }

  function processEpisodes(episodeUrls, index) {
    if (index >= episodeUrls.length) {
      return Promise.resolve();
    }
    const episodeUrl = episodeUrls[index];
    if (seenEpisodes.has(episodeUrl)) {
      return processEpisodes(episodeUrls, index + 1);
    }
    seenEpisodes.add(episodeUrl);
    return fetchText(fetchImpl, episodeUrl, { headers: BROWSER_HEADERS })
      .then(function (episode) {
        if (!episode) {
          return processEpisodes(episodeUrls, index + 1);
        }
        const viddUrls = tvarticlesLinks(episode);
        return processViddUrls(viddUrls, 0);
      })
      .then(function () {
        return processEpisodes(episodeUrls, index + 1);
      });
  }

  function processViddUrls(viddUrls, index) {
    if (index >= viddUrls.length) {
      return Promise.resolve();
    }
    return resolveTvarticlePage(viddUrls[index], { fetchImpl: fetchImpl, request: request })
      .then(function (stream) {
        if (stream && !seenBackends.has(stream.backend) && !seenStreams.has(stream.url)) {
          seenBackends.add(stream.backend);
          seenStreams.add(stream.url);
          streams.push(stream);
        }
        return processViddUrls(viddUrls, index + 1);
      });
  }

  return processArchive(0);
}

function displayBackend(backend) {
  return String(backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, function (_match, prefix, ch) { return prefix + ch.toUpperCase(); })
    .replace(/[-_]+/g, "");
}

function episodeLabel(request) {
  const season = String(request.season || 0).padStart(2, "0");
  const episode = String(request.episode || 0).padStart(2, "0");
  const parts = [request.title + " S" + season + "E" + episode];
  const episodeTitle = String(request.episodeTitle || "").trim();
  if (episodeTitle && !new RegExp("^episode\\s+" + request.episode + "$", "i").test(episodeTitle)) {
    parts.push(episodeTitle);
  }
  if (request.runtimeMinutes) {
    parts.push(request.runtimeMinutes + "m");
  }
  return parts.join(" - ");
}

function toNuvioStream(request, stream) {
  return {
    name: "Desi-Serials.to " + displayBackend(stream.backend),
    title: episodeLabel(request) + " - " + stream.quality + " " + String(stream.kind || "stream").toUpperCase(),
    url: stream.url,
    quality: stream.quality,
    size: stream.size || "",
    headers: stream.headers || {},
  };
}

function getStreamsForRequest(request, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const seen = new Set();
  const streams = [];
  return resolveDesiSerials(request, { fetchImpl: fetchImpl })
    .then(function (resolved) {
      for (const stream of resolved) {
        if (!stream || !stream.url || seen.has(stream.url)) {
          continue;
        }
        seen.add(stream.url);
        streams.push(toNuvioStream(request, stream));
      }
      return streams;
    })
    .catch(function (error) {
      console.log("[Desi-Serials.to] resolver failed: " + error.message);
      return streams;
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
      console.log("[Desi-Serials.to] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getStreams: getStreams,
    getStreamsForRequest: getStreamsForRequest,
    buildMediaRequest: buildMediaRequest,
    resolveDesiSerials: resolveDesiSerials,
  };
} else {
  global.getStreams = getStreams;
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c providers/desi-serials-to.js`
Expected: no output.

- [ ] **Step 3: Verify module loads and exports `getStreams`**

Run: `node -e "const s = require('./providers/desi-serials-to.js'); console.log(typeof s.getStreams, typeof s.getStreamsForRequest, typeof s.buildMediaRequest)"`
Expected: `function function function`

- [ ] **Step 4: Commit**

```bash
git add providers/desi-serials-to.js
git commit -m "$(cat <<'EOF'
feat: add resolveDesiSerials orchestrator and getStreams entry point

resolveDesiSerials walks archive URLs -> episode pages -> tvarticles
links -> player resolvers using recursive promise chains (sequential,
matching the original async behavior). getStreams is the Nuvio entry
point: tv-only guard, TMDB lookup with the hardcoded key, then
getStreamsForRequest maps backend streams to Nuvio stream objects.
Dual module.exports / global.getStreams export for Node and Nuvio.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 5: Rewrite manifest.json

**Files:**
- Modify: `manifest.json` (full rewrite)

- [ ] **Step 1: Replace `manifest.json` with the new content**

Overwrite the file with:

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

- [ ] **Step 2: Verify the JSON parses and points at the scraper file**

Run: `node -e "const m = require('./manifest.json'); console.log(m.scrapers[0].id, m.scrapers[0].filename)"`
Expected: `desi-serials-to providers/desi-serials-to.js?v=1`

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "$(cat <<'EOF'
feat: point manifest at the new single-file desi-serials-to scraper

Scraper id renamed from "desi-serials" to "desi-serials-to" to
identify the source site. Filename points at providers/desi-serials-to.js.
No hasSettings field — TMDB key is hardcoded in the scraper.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 6: Rewrite README.md

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Replace `README.md` with Nuvio-only content**

Overwrite the file with:

```markdown
# desi-serials-nuvio-provider

A Nuvio client-side scraper that resolves Indian TV serial episodes from
`desi-serials.to`. It walks the show's archive page on `desi-serials.to`,
finds the episode page matching the TMDB air date, follows the
`tvarticles.org` link, and resolves one of two single-stream player
families:

- **VkPrime** — direct MP4 streams (via Dean-Edwards packer unpack)
- **Flow.tvlogy** — HLS `.m3u8` streams with playback headers

TMDB is used for title + episode air-date lookup only. The TMDB API key
is hardcoded in the scraper file (matching the convention used by other
client-side Nuvio scrapers such as phisher98/MoviesDrive and
D3adlyRocket/4khdhub).

## Install

1. Open **Nuvio** → **Settings** → **Local Scrapers**
2. Add this repository's `manifest.json` URL
3. Enable **Desi-Serials.to**

## Supported content

- **TV only.** Movies return no streams.
- Episode matching uses the TMDB air date + show slug against the
  `desi-serials.to` archive. If an episode is missing from
  `desi-serials.to`, no stream is returned for it.

## Repo layout

```
providers/desi-serials-to.js   # single hand-maintained scraper file
manifest.json                  # points Nuvio at the scraper
README.md
.gitignore
```

No build step, no tests, no package.json. The scraper is plain
JavaScript using Promise chains (Hermes-compatible — no async/await,
which Hermes does not support in dynamically loaded plugins without
transpilation).

## Local probe (optional)

```bash
node -c providers/desi-serials-to.js   # syntax check
node -e "const s = require('./providers/desi-serials-to.js'); console.log(typeof s.getStreams)"
```

For a live probe against a real TMDB ID, write a throwaway script that
calls `s.getStreams(tmdbId, "tv", season, episode)` and logs the result.
Do not commit probe scripts — they exercise live mirrors and depend on
network availability.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: rewrite README for the single-file Nuvio scraper

Removes all Python scraper, Plex cron, yt-dlp, and build-tooling
documentation. Covers install, supported content, repo layout, and
local probe commands.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 7: Simplify .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Replace `.gitignore` with Nuvio-relevant entries**

Overwrite the file with:

```
__pycache__/
*.pyc

.env
.venv/

.claude/
.remember/

node_modules/
```

The Python entries are kept in case any local tooling drops pycache, but the scraper-relevant entries (`.scratch/`, `*.partial`, `.concat.txt`, `*.mp4`, `*.m3u8`, `pw/`) are removed — they were for the deleted Python downloader.

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "$(cat <<'EOF'
chore: trim .gitignore to relevant entries

Removes Python scratch/partial/concat/mp4/m3u8 and pw/ entries that
belonged to the deleted downloader. Keeps pycache, env, and tooling
ignores.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 8: Delete the old Python scraper and legacy plugin tree

**Files:**
- Delete: `scraper.py`, `backends.py`, `test_scraper.py`
- Delete: `__pycache__/`, `pw/`
- Delete: `desi-serials/` (entire tree — superseded by `providers/desi-serials-to.js`)
- Delete: `build.js`, `package.json`, `package-lock.json`, `node_modules/`
- Delete: `live-validation/`
- Delete: `src/` (empty root dir)

This is a destructive operation (bulk file deletion). Confirm with the user before running if executing manually; if executing as a subagent, the user has already approved the spec which lists these deletions.

- [ ] **Step 1: Delete the Python scraper files**

Run: `git rm scraper.py backends.py test_scraper.py`
Expected: three files removed from the index and working tree.

- [ ] **Step 2: Delete Python artifacts and Playwright dir**

Run: `rm -rf __pycache__ pw && git rm -r --cached --ignore-unmatch __pycache__ pw 2>/dev/null; true`
Expected: `__pycache__/` and `pw/` removed from the working tree. (They may not be in git since `__pycache__/` and `pw/` were gitignored — that's fine.)

- [ ] **Step 3: Delete the old multi-file plugin tree**

Run: `git rm -r desi-serials`
Expected: the `desi-serials/` tree removed from the index and working tree. This includes `desi-serials/desi-serials.js`, `src/`, `backends/`, `tests/`, `scripts/`, `config.js`, etc.

- [ ] **Step 4: Delete the Node build tooling**

Run: `git rm build.js package.json package-lock.json && rm -rf node_modules`
Expected: `build.js`, `package.json`, `package-lock.json` removed from index. `node_modules/` removed from working tree (was gitignored).

- [ ] **Step 5: Delete the live-validation directory**

Run: `git rm -r live-validation`
Expected: `live-validation/` removed from index and working tree. (It was untracked, so `git rm` may fail — if so, use `rm -rf live-validation` instead.)

If `git rm -r live-validation` fails with "did not match any files", run: `rm -rf live-validation`

- [ ] **Step 6: Delete the empty root `src/` directory**

Run: `rmdir src 2>/dev/null; true`
Expected: empty `src/` removed (no output). If it has contents, leave it and investigate.

- [ ] **Step 7: Verify the working tree is clean and matches the target layout**

Run: `git status && echo "---" && ls -la`
Expected: working tree shows only `providers/`, `manifest.json`, `README.md`, `.gitignore`, plus `.git/`, `.claude/`, `.remember/`, `docs/` (docs removed in Task 9).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: remove Python scraper, legacy plugin tree, and build tooling

Deletes:
- scraper.py, backends.py, test_scraper.py (Python daily-soap-scraper)
- desi-serials/ (old multi-file JS plugin, superseded by providers/)
- build.js, package.json, package-lock.json, node_modules (no build step)
- live-validation/ (manual validation screenshots)
- pw/, __pycache__/ (Python artifacts)

The repo is now a single-file Nuvio scraper: providers/desi-serials-to.js
plus manifest.json and README.md.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 9: Remove the docs/ directory (specs and plans)

**Files:**
- Delete: `docs/` (contains the spec and this plan, plus the older yt-dlp spec/plan)

The spec and plan are working artifacts, not shipped docs. They've served their purpose. Remove the directory now that implementation is complete.

- [ ] **Step 1: Delete the docs directory**

Run: `git rm -r docs`
Expected: `docs/` removed from index and working tree.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: remove docs/ (specs and plans)

The design spec and implementation plan were working artifacts for
the cleanup. They are not shipped documentation and have served
their purpose.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)"
```

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Verify the scraper file syntax**

Run: `node -c providers/desi-serials-to.js`
Expected: no output.

- [ ] **Step 2: Verify the module loads and exports `getStreams`**

Run: `node -e "const s = require('./providers/desi-serials-to.js'); console.log(typeof s.getStreams, typeof s.getStreamsForRequest, typeof s.buildMediaRequest, typeof s.resolveDesiSerials)"`
Expected: `function function function function`

- [ ] **Step 3: Verify the manifest points at the right file**

Run: `node -e "const m = require('./manifest.json'); const s = m.scrapers[0]; console.log(s.id, s.name, s.filename, s.supportedTypes, s.hasSettings || '(none)')"`
Expected: `desi-serials-to Desi-Serials.to providers/desi-serials-to.js?v=1 [ 'tv' ] (none)`

- [ ] **Step 4: Verify the repo layout is clean**

Run: `git ls-files | sort`
Expected:
```
.gitignore
README.md
manifest.json
providers/desi-serials-to.js
```

If anything else appears, decide whether it should be deleted or kept (e.g., `.claude/` and `.remember/` are gitignored so won't appear here).

- [ ] **Step 5: Smoke test via Nuvio Plugin Tester or tailscale funnel**

This is a manual step performed by the user. Load `manifest.json` in Nuvio's Plugin Tester or via the tailscale funnel as previously done. Call `getStreams` with a known Anupamaa TMDB ID + season + episode. Confirm streams are returned.

No commit — this is verification only. If the smoke test fails, file the failure as a new debugging task; do not mark the plan complete.

---

## Self-Review

**Spec coverage:**
- Single scraper file `providers/desi-serials-to.js` → Tasks 1-4 ✓
- Hardcoded `TMDB_API_KEY` constant, no settings UI, no `onSettings`, no lookup chain → Task 1 (constant) + Task 4 (getStreams uses it directly) + Task 5 (manifest has no `hasSettings`) ✓
- Manifest with id `desi-serials-to`, name `Desi-Serials.to`, filename `providers/desi-serials-to.js?v=1` → Task 5 ✓
- Promise chains, no async/await → Tasks 2-4 (all async functions are `.then()` chains) ✓
- Dual `module.exports` / `global.getStreams` export → Task 4 ✓
- Stream object format (`name`, `title`, `url`, `quality`, `size`, `headers`) → Task 4 (`toNuvioStream`) ✓
- Delete Python scraper, `desi-serials/` tree, build tooling, `live-validation/`, empty `src/`, `__pycache__/`, `pw/` → Task 8 ✓
- Delete `docs/` → Task 9 ✓
- README rewrite (Nuvio-only) → Task 6 ✓
- `.gitignore` simplification → Task 7 ✓
- Verification (`node -c`, module load, manifest check, smoke test) → Task 10 ✓

**Placeholder scan:** No "TBD", "TODO", or "implement later" in any step. All code blocks contain the actual code to write. The two corrections in Task 1 (`episodeDateSlug` body) and Task 3 (`VKPRIME_RE` not `VKSPEED_RE`) are explicit and show the corrected code.

**Type consistency:** `getStreams(tmdbId, mediaType, season, episode)` signature matches across Task 4 (definition) and Task 10 (verification). `buildMediaRequest(tmdbId, mediaType, season, episode, options)` matches between Task 2 (definition) and Task 4 (call). `resolveDesiSerials(request, options)` matches between Task 4 (definition) and Task 4 (`getStreamsForRequest` call). Stream object fields in `toNuvioStream` match the table in the spec.

**One note on the recursive Promise-chain pattern in Task 4:** `resolveDesiSerials` uses recursive helpers (`processArchive`, `processEpisodes`, `processViddUrls`) instead of `for...of` + `await`. This preserves the sequential behavior of the original (each archive URL is fetched in turn; the resolver returns as soon as one archive yields streams). `Promise.all` would parallelize fetches, which is faster but changes the failure semantics and could hammer the site — the spec calls for a faithful port, so sequential is correct.
