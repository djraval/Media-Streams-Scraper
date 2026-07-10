// VkPrime/VkSpeed player resolution + JW Player source parsing.

import { decodeText, mp4Candidates, dedupe } from "./html.js";
import { resolveFetch, fetchText, browserHeaders, fetchContentLength } from "./http.js";
import { unpack } from "./packer.js";

export { resolveFetch, fetchText, browserHeaders, fetchContentLength };

export function qualityNearUrl(text, url) {
  var index = text.indexOf(url);
  if (index === -1) return 0;
  var before = text.substring(Math.max(0, index - 80), index);
  var after = text.substring(index, index + 120);
  var matches = (before + after).match(/(\d{3,4})p?/gi) || [];
  if (matches.length === 0) return 0;
  return Number(matches[matches.length - 1]);
}

export function jwPlayerSourceQualities(raw) {
  var text = decodeText(raw);
  var map = new Map();
  var re = /\{\s*(?:file|src)\s*:\s*["']([^"']+)["']\s*,\s*(?:label|quality|res)\s*:\s*["']?(\d{3,4})p?["']?\s*[^}]*\}/gi;
  var m;
  while ((m = re.exec(text)) !== null) {
    map.set(m[1], Number(m[2]));
  }
  var re2 = /\{\s*(?:label|quality|res)\s*:\s*["']?(\d{3,4})p?["']?\s*,\s*(?:file|src)\s*:\s*["']([^"']+)["']\s*[^}]*\}/gi;
  while ((m = re2.exec(text)) !== null) {
    if (!map.has(m[2])) {
      map.set(m[2], Number(m[1]));
    }
  }
  return map;
}

export function rankedMp4Candidates(raw) {
  var text = decodeText(raw);
  var jwMap = jwPlayerSourceQualities(raw);
  return mp4Candidates(text)
    .map(function (url) { return { url: url, quality: jwMap.get(url) || qualityNearUrl(text, url) || 0 }; })
    .sort(function (a, b) { return b.quality - a.quality; });
}

export function mp4QualityLabel(height) {
  if (!height) return "unknown";
  return height < 480 ? "unknown" : height + "p";
}

// Provisional quality only — JW labels lie (360p for real 720p AND for real 360p).
// Callers must run labelStreamFromProbe on the chosen MP4 URL.
export function resolveVkPlayer(embedUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  return fetchText(fetchImpl, embedUrl, browserHeaders(refererUrl))
    .then(function (playerHtml) {
      if (!playerHtml) return [];
      var decoded = unpack(playerHtml);
      // Combine raw and unpacked content — some MP4 URLs appear only in the
      // unpacked payload, others in the raw HTML. Searching both together
      // ensures we find all sources and rank them correctly.
      var payload = [playerHtml, decoded].filter(Boolean).join("\n");
      var sources = rankedMp4Candidates(payload);
      return sources.map(function (src) {
        return {
          url: src.url,
          quality: "unknown",
          kind: "mp4",
          headers: { Referer: embedUrl, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
        };
      });
    })
    .catch(function () { return []; });
}
