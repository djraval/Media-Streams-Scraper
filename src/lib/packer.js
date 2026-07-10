// Dean Edwards P.A.C.K.E.R. unpacker + JuicyCodes decoder + base64.

export var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function decodeBase64(raw) {
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

export function packerEncode(n, base) {
  if (n === 0) return "0";
  var out = "";
  var value = n;
  while (value > 0) {
    var r = value % base;
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

export function unpack(blob) {
  var match = String(blob || "").match(
    /eval\(function\(p,a,c,k,e,(?:d|r)\).*?\}\s*\(\s*'(.*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)/s,
  );
  if (!match) return "";

  var out = match[1].replace(/\\'/g, "'");
  var base = Number(match[2]);
  var count = Number(match[3]);
  var keys = match[4].replace(/\\'/g, "'").split("|");

  for (var i = count - 1; i >= 0; i -= 1) {
    if (!keys[i]) continue;
    var token = packerEncode(i, base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp("\\b" + token + "\\b", "g"), keys[i]);
  }
  return out;
}

export function decodeJuicyCodes(html) {
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
