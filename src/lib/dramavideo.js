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
