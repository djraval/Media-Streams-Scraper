// DramaVideo resolver — supports both embed forms seen in the wild:
//
//   A) apnetv.pro-style posts: <div class="server" data-sv-id="v3" data-embed="CODE">
//      → player.dramavideo.se/in?id={embed}&sv={svId}
//
//   B) godesitvserials.com-style posts: data-a + data-b base64 halves that join into
//      https://dramavideo.se/watch?v={id}; the watch page carries
//      <li class="linkserver" data-provider="v3" data-video="CODE"> → same /in URL
//
//   /in page ends with a PLAINTEXT decrypt block:
//      encData="..."; keyHex="..."; ivHex="..."  (AES-256-CBC, base64 ciphertext)
//   Decrypted HTML contains  sources = JSON.parse(`[{file,type,label}]`)
//   → https://hls.dramavideo.se/media/{hex} HLS (needs Origin: https://player.dramavideo.se)
//
// AES via crypto.subtle (available in Nuvio QuickJS); crypto-js fallback for envs
// without WebCrypto.

import { UA } from "./constants.js";
import { fetchText } from "./http.js";
import { dedupeStreams } from "./html.js";

var PLAYER_HOST = "https://player.dramavideo.se";
var PLAYER_ORIGIN = PLAYER_HOST;

// Extract data-embed/data-sv-id (apnetv) or data-video/data-provider (linkserver li)
// pairs from post/watch markup. Returns [{id, sv}].
export function dramavideoParamsFromMarkup(markup) {
  var text = String(markup || "");
  var out = [];
  var tagRe = /<(?:div|li|a|span|button)[^>]*data-(?:embed|video)="[^"]+"[^>]*>/gi;
  var m;
  while ((m = tagRe.exec(text)) !== null) {
    var tag = m[0];
    var idM = tag.match(/data-(?:embed|video)="([^"]+)"/i);
    var svM = tag.match(/data-(?:sv-id|svid|provider)="([^"]+)"/i);
    if (idM) {
      out.push({ id: idM[1], sv: svM ? svM[1] : "v3" });
    }
  }
  return out;
}

// godesitvserials: <... data-a="aHR0cHM6..." data-b="LnNlL3d..."> — base64 halves
// joined into https://dramavideo.se/watch?v={id}
export function dramavideoWatchUrlFromMarkup(markup) {
  var text = String(markup || "");
  var m = text.match(/data-a="([A-Za-z0-9+/=]{8,})"[^>]*data-b="([A-Za-z0-9+/=]{8,})"/i);
  if (!m) {
    m = text.match(/data-b="([A-Za-z0-9+/=]{8,})"[^>]*data-a="([A-Za-z0-9+/=]{8,})"/i);
    if (!m) return "";
    // swapped order in the tag — a is second capture
    return decodeJoin(m[2], m[1]);
  }
  return decodeJoin(m[1], m[2]);
}

function decodeJoin(a, b) {
  var decoded = base64Decode(a) + base64Decode(b);
  return /dramavideo\.se\/watch\?v=\d+/i.test(decoded) ? decoded : "";
}

function base64Decode(s) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(s || "").replace(/[^A-Za-z0-9+/=]/g, "");
  var out = "";
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < clean.length; i++) {
    var c = clean.charAt(i);
    if (c === "=") break;
    buffer = (buffer << 6) | chars.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function hexToBytes(hex) {
  var str = String(hex || "");
  var bytes = new Uint8Array(str.length / 2);
  for (var i = 0; i < str.length; i += 2) {
    bytes[i / 2] = parseInt(str.substr(i, 2), 16);
  }
  return bytes;
}

function extractCipher(markup) {
  var text = String(markup || "");
  var enc = text.match(/encData\s*=\s*"([^"]+)"/);
  var key = text.match(/keyHex\s*=\s*"([0-9a-fA-F]+)"/);
  var iv = text.match(/ivHex\s*=\s*"([0-9a-fA-F]+)"/);
  if (!enc || !key || !iv) return null;
  return { encData: enc[1], keyHex: key[1], ivHex: iv[1] };
}

// Decrypted HTML carries sources = JSON.parse(`[{file,type,label}]`) plus a tracks array.
function extractSources(decryptedHtml) {
  var text = String(decryptedHtml || "");
  var streams = [];
  var m = text.match(/JSON\.parse\(`(\[[^`]*"file"[^`]*\])`\)/);
  if (m) {
    try {
      var parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) {
        parsed.forEach(function (s) {
          if (s && s.file) {
            streams.push({ url: s.file, kind: s.type === "mp4" ? "mp4" : "hls", label: s.label || "" });
          }
        });
      }
    } catch (e) {
      /* fall through to regex */
    }
  }
  if (streams.length === 0) {
    var urls = text.match(/https:\/\/hls\.dramavideo\.se\/media\/[0-9a-f]+/gi) || [];
    urls.forEach(function (u) {
      streams.push({ url: u, kind: "hls", label: "" });
    });
  }
  return streams;
}

function aesCbcDecrypt(encData, keyHex, ivHex) {
  var keyBytes = hexToBytes(keyHex);
  var ivBytes = hexToBytes(ivHex);
  var cipherBytes = Uint8Array.from(
    atobBinary(encData).split("").map(function (c) { return c.charCodeAt(0); }),
  );

  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.decrypt) {
    return crypto.subtle
      .importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"])
      .then(function (key) {
        return crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, cipherBytes);
      })
      .then(function (plain) {
        return u8ToString(new Uint8Array(plain));
      });
  }

  // crypto-js fallback (available via require in the Nuvio sandbox)
  try {
    var CryptoJS = require("crypto-js");
    var keyWA = CryptoJS.enc.Hex.parse(keyHex);
    var ivWA = CryptoJS.enc.Hex.parse(ivHex);
    var params = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(encData),
    });
    var out = CryptoJS.AES.decrypt(params, keyWA, {
      iv: ivWA,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    return Promise.resolve(out.toString(CryptoJS.enc.Utf8));
  } catch (e) {
    return Promise.reject(new Error("No AES implementation available"));
  }
}

function atobBinary(s) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(s || "").replace(/[^A-Za-z0-9+/=]/g, "");
  var out = "";
  var buffer = 0;
  var bits = 0;
  for (var i = 0; i < clean.length; i++) {
    var c = clean.charAt(i);
    if (c === "=") break;
    buffer = (buffer << 6) | chars.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function u8ToString(u8) {
  // UTF-8 decode without TextDecoder (not in vanilla QuickJS)
  var out = "";
  var i = 0;
  while (i < u8.length) {
    var b = u8[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (u8[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((u8[i + 1] & 0x3f) << 6) | (u8[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      var cp =
        ((b & 0x07) << 18) |
        ((u8[i + 1] & 0x3f) << 12) |
        ((u8[i + 2] & 0x3f) << 6) |
        (u8[i + 3] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    }
  }
  return out;
}

// Fetch player page /in?id=...&sv=... and decrypt the sources array.
export function resolveDramavideoEmbed(fetchImpl, id, sv, referer) {
  var playerUrl = PLAYER_HOST + "/in?id=" + encodeURIComponent(id) + "&sv=" + encodeURIComponent(sv || "v3");
  var headers = { "User-Agent": UA, Referer: referer || "https://dramavideo.se/" };
  return fetchText(fetchImpl, playerUrl, { headers: headers })
    .then(function (page) {
      if (!page) return [];
      var cipher = extractCipher(page);
      if (!cipher) return [];
      return aesCbcDecrypt(cipher.encData, cipher.keyHex, cipher.ivHex).then(function (decrypted) {
        return extractSources(decrypted).map(function (s) {
          s.backend = "dramavideo";
          s.quality = s.label || "";
          s.headers = {
            "User-Agent": UA,
            Referer: PLAYER_HOST + "/",
            Origin: PLAYER_ORIGIN,
          };
          return s;
        });
      });
    })
    .catch(function (e) {
      console.log("[DramaVideo] resolve failed: " + (e && e.message));
      return [];
    });
}

// godesitvserials watch flow: watch URL → linkserver li → /in
export function resolveDramavideoWatch(fetchImpl, watchUrl, referer) {
  var headers = { "User-Agent": UA, Referer: referer || "https://dramavideo.se/" };
  return fetchText(fetchImpl, watchUrl, { headers: headers })
    .then(function (page) {
      if (!page) return [];
      var params = dramavideoParamsFromMarkup(page);
      if (params.length === 0) return [];
      return Promise.all(
        params.slice(0, 3).map(function (p) {
          return resolveDramavideoEmbed(fetchImpl, p.id, p.sv, watchUrl);
        }),
      ).then(function (sets) {
        return dedupeStreams(sets.flat ? sets.flat() : [].concat.apply([], sets));
      });
    })
    .catch(function (e) {
      console.log("[DramaVideo] watch resolve failed: " + (e && e.message));
      return [];
    });
}
