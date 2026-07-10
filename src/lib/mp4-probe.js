// Slim MP4 resolution probe — first 64KB only (faststart moov).
// One Range request. No moov-at-end fallback (too slow/fragile for plugin path).

import { fetchBinaryRange } from "./http.js";

function readUint32BE(u8, offset) {
  return ((u8[offset] * 0x1000000) + (u8[offset + 1] << 16) + (u8[offset + 2] << 8) + u8[offset + 3]) >>> 0;
}

function readUint16BE(u8, offset) {
  return ((u8[offset] << 8) + u8[offset + 1]) >>> 0;
}

function readFourCC(u8, offset) {
  return String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
}

export function qualityFromResolution(width, height) {
  if (!height || height <= 0) return "unknown";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  if (height >= 360) return "360p";
  if (height >= 240) return "240p";
  return "unknown";
}

// Returns { width, height } or null.
export function probeMp4Resolution(url, headers) {
  return fetchBinaryRange(url, headers, 0, 65535)
    .then(function (u8) {
      if (!u8 || u8.length < 32) return null;
      return parseMp4Root(u8, u8.length);
    })
    .catch(function () { return null; });
}

function parseMp4Root(u8, end) {
  var offset = 0;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8) break;
    var boxEnd = offset + size;
    if (boxEnd > end) boxEnd = end;
    if (type === "moov") {
      var result = parseMoov(u8, offset + 8, boxEnd);
      if (result) return result;
    }
    // non-faststart: mdat first — give up (no end-of-file fetch)
    if (type === "mdat") return null;
    offset += size;
  }
  return null;
}

function parseMoov(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8) break;
    var boxEnd = offset + size;
    if (boxEnd > end) boxEnd = end;
    if (type === "trak") {
      var result = parseTrak(u8, offset + 8, boxEnd);
      if (result && result.width > 0 && result.height > 0) return result;
    }
    offset += size;
  }
  return null;
}

function parseTrak(u8, start, end) {
  var tkhdResult = null;
  var stsdResult = null;
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8) break;
    var boxEnd = offset + size;
    if (boxEnd > end) boxEnd = end;
    if (type === "tkhd") {
      tkhdResult = parseTkhd(u8, offset + 8, boxEnd);
    } else if (type === "mdia") {
      stsdResult = parseMdia(u8, offset + 8, boxEnd);
    }
    offset += size;
  }
  if (stsdResult && stsdResult.width > 0 && stsdResult.height > 0) return stsdResult;
  return tkhdResult;
}

function parseTkhd(u8, start, end) {
  if (start + 4 > end) return null;
  var version = u8[start];
  var width, height;
  if (version === 1) {
    if (start + 104 > end) return null;
    width = readUint32BE(u8, start + 96);
    height = readUint32BE(u8, start + 100);
  } else {
    if (start + 84 > end) return null;
    width = readUint32BE(u8, start + 76);
    height = readUint32BE(u8, start + 80);
  }
  return { width: Math.round(width / 65536), height: Math.round(height / 65536) };
}

function parseMdia(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8) break;
    var boxEnd = offset + size;
    if (boxEnd > end) boxEnd = end;
    if (type === "minf") {
      var r = parseMinf(u8, offset + 8, boxEnd);
      if (r) return r;
    }
    offset += size;
  }
  return null;
}

function parseMinf(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8) break;
    var boxEnd = offset + size;
    if (boxEnd > end) boxEnd = end;
    if (type === "stbl") {
      var r = parseStbl(u8, offset + 8, boxEnd);
      if (r) return r;
    }
    offset += size;
  }
  return null;
}

function parseStbl(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8) break;
    var boxEnd = offset + size;
    if (boxEnd > end) boxEnd = end;
    if (type === "stsd") {
      var r = parseStsd(u8, offset + 8, boxEnd);
      if (r) return r;
    }
    offset += size;
  }
  return null;
}

function parseStsd(u8, start, end) {
  if (start + 8 > end) return null;
  var offset = start + 8;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8) break;
    var boxEnd = offset + size;
    if (boxEnd > end) boxEnd = end;
    if (type === "avc1" || type === "avc3" || type === "hvc1" || type === "hev1" || type === "mp4v") {
      if (offset + 8 + 28 <= end) {
        return {
          width: readUint16BE(u8, offset + 8 + 24),
          height: readUint16BE(u8, offset + 8 + 26),
        };
      }
    }
    offset += size;
  }
  return null;
}

// Probe stream.url once; overwrite quality if resolution found. Keeps original otherwise.
export function labelStreamFromProbe(stream) {
  if (!stream || !stream.url || stream.url.indexOf(".mp4") < 0) {
    return Promise.resolve(stream);
  }
  return probeMp4Resolution(stream.url, stream.headers || {})
    .then(function (result) {
      if (result && result.height > 0) {
        stream.quality = qualityFromResolution(result.width, result.height);
      }
      return stream;
    })
    .catch(function () { return stream; });
}
