// FileMoon resolver — AES-256-GCM decryption via crypto.subtle.
// API: GET https://filemoon.to/api/videos/{code} → encrypted playback data.
// Key selection: key_parts[version-1] + key_parts[30-version] → 32-byte AES-256 key.
// Decrypt with crypto.subtle (Web Crypto API, available in Nuvio QuickJS).
// No AAD, 12-byte IV, 128-bit tag (standard GCM, ciphertext+tag combined).

import { UA, BROWSER_HEADERS } from "./constants.js";
import { fetchText } from "./http.js";

var FILEMOON_HOSTS = [
  "filemoon.to", "filemoon.sx", "filemoon.in", "filemoon.link",
  "filemoon.nl", "filemoon.wf", "cinegrab.com", "filemoon.eu",
  "filemoon.art", "moonmov.pro",
];

// Base64url → bytes (no Buffer/atob in Nuvio sandbox).
function base64UrlToBytes(str) {
  var input = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  // Pad to multiple of 4
  var pad = input.length % 4;
  if (pad) input += "====".substring(0, 4 - pad);

  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var output = [];
  var buffer = 0;
  var bits = 0;

  for (var i = 0; i < input.length; i++) {
    var ch = input.charAt(i);
    if (ch === "=") break;
    var idx = chars.indexOf(ch);
    if (idx === -1) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}

// Uint8Array → string (no TextDecoder in Nuvio sandbox).
function bytesToString(bytes) {
  var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  var str = "";
  var chunk = 0x8000;
  for (var i = 0; i < arr.length; i += chunk) {
    str += String.fromCharCode.apply(null, arr.subarray(i, Math.min(i + chunk, arr.length)));
  }
  return str;
}

// Concatenate two Uint8Arrays.
function concatBytes(a, b) {
  var result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

// Extract FileMoon video code from embed URL.
export function extractFileMoonCode(url) {
  var str = String(url || "");
  for (var i = 0; i < FILEMOON_HOSTS.length; i++) {
    var host = FILEMOON_HOSTS[i];
    if (str.indexOf(host) !== -1) {
      var match = str.match(new RegExp("(?:/e/|/d/)([0-9a-zA-Z]+)"));
      if (match) return match[1];
    }
  }
  // Also match raw 12-char codes
  var codeMatch = str.match(/\/(?:e|d)\/([0-9a-zA-Z]{10,})/);
  return codeMatch ? codeMatch[1] : null;
}

// Check if URL is a FileMoon embed.
export function isFileMoonUrl(url) {
  var str = String(url || "");
  for (var i = 0; i < FILEMOON_HOSTS.length; i++) {
    if (str.indexOf(FILEMOON_HOSTS[i]) !== -1) return true;
  }
  return false;
}

// Decrypt FileMoon playback data using crypto.subtle AES-256-GCM.
// Returns Promise<{ sources: Array, poster: string }>.
function decryptPlayback(playback) {
  var version = Number(playback.version);
  var keyParts = playback.key_parts || [];

  // Key selection: key_parts[version-1] + key_parts[30-version] (0-based)
  var idx1 = version - 1;
  var idx2 = 30 - version;
  if (idx1 < 0 || idx1 >= keyParts.length || idx2 < 0 || idx2 >= keyParts.length) {
    return Promise.reject(new Error("FileMoon: invalid key indices"));
  }

  var keyPart1 = base64UrlToBytes(keyParts[idx1]);
  var keyPart2 = base64UrlToBytes(keyParts[idx2]);
  var keyBytes = concatBytes(keyPart1, keyPart2);

  if (keyBytes.length !== 32) {
    return Promise.reject(new Error("FileMoon: key length " + keyBytes.length + ", expected 32"));
  }

  var ivBytes = base64UrlToBytes(playback.iv);
  var payloadBytes = base64UrlToBytes(playback.payload);

  // crypto.subtle.decrypt expects ciphertext + tag together (standard GCM format).
  // No need to split — pass the full payload. No AAD.
  var subtle = (typeof crypto !== "undefined" && crypto.subtle) || (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle);
  if (!subtle) {
    return Promise.reject(new Error("FileMoon: crypto.subtle not available"));
  }

  return subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"])
    .then(function (key) {
      return subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, payloadBytes);
    })
    .then(function (decrypted) {
      var json = bytesToString(new Uint8Array(decrypted));
      return JSON.parse(json);
    });
}

// Resolve a FileMoon embed URL to stream(s).
// Returns Promise<Array<{ url, quality, label, height, bitrate, sizeBytes, kind }>>.
export function resolveFileMoon(fetchImpl, embedUrl, refererUrl) {
  var code = extractFileMoonCode(embedUrl);
  if (!code) return Promise.resolve([]);

  // Pick a FileMoon host — prefer the one in the embed URL, fallback to filemoon.to
  var apiHost = "filemoon.to";
  for (var i = 0; i < FILEMOON_HOSTS.length; i++) {
    if (String(embedUrl).indexOf(FILEMOON_HOSTS[i]) !== -1) {
      apiHost = FILEMOON_HOSTS[i];
      break;
    }
  }

  var apiUrl = "https://" + apiHost + "/api/videos/" + code;
  var headers = Object.assign({}, BROWSER_HEADERS);
  if (refererUrl) headers.Referer = refererUrl;

  return fetchImpl(apiUrl, { headers: headers })
    .then(function (response) {
      if (!response || response.ok === false) return null;
      return response.json();
    })
    .then(function (data) {
      if (!data || !data.playback) return [];

      return decryptPlayback(data.playback).then(function (decrypted) {
        var sources = (decrypted.sources || []).filter(function (s) {
          return s.url && s.mime_type === "application/vnd.apple.mpegurl";
        });

        return sources.map(function (s) {
          return {
            url: s.url,
            quality: s.label || (s.height ? s.height + "p" : ""),
            label: s.label || "",
            height: s.height || 0,
            bitrate: s.bitrate_kbps ? s.bitrate_kbps * 1000 : 0,
            sizeBytes: s.size_bytes || 0,
            kind: "hls",
          };
        });
      });
    })
    .catch(function () {
      return [];
    });
}
