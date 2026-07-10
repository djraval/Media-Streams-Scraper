// MP4 resolution probe — pure JS, no Node.js modules.
// Fetches first 64KB, parses MP4 box hierarchy to extract video resolution.

import { fetchBinary } from "./http.js";

var CODEC_BOXES = { avc1: 1, avc3: 1, hvc1: 1, hev1: 1, hvc2: 1, shv1: 1, mp4v: 1 };

export function readUint32BE(u8, offset) {
  return ((u8[offset] * 0x1000000) + (u8[offset + 1] << 16) + (u8[offset + 2] << 8) + u8[offset + 3]) >>> 0;
}

export function readUint16BE(u8, offset) {
  return ((u8[offset] << 8) + u8[offset + 1]) >>> 0;
}

export function readUint8(u8, offset) {
  return u8[offset];
}

export function readFourCC(u8, offset) {
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
  if (height >= 144) return "144p";
  return "unknown";
}

export function probeMp4Resolution(url, headers, rangeBytes) {
  return fetchBinary(url, headers, rangeBytes || 65536)
    .then(function (u8) {
      if (!u8 || u8.length < 16) return null;
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
  var version = readUint8(u8, start);
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
  return { width: Math.round(width / 65536), height: Math.round(height / 65536), codec: "" };
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
    if (CODEC_BOXES[type]) {
      return parseVisualSampleEntry(u8, offset + 8, boxEnd, type);
    }
    var inner = findCodecBox(u8, offset + 8, boxEnd);
    if (inner) return inner;
    offset += size;
  }
  return null;
}

function findCodecBox(u8, start, end) {
  var offset = start;
  while (offset + 8 <= end) {
    var size = readUint32BE(u8, offset);
    var type = readFourCC(u8, offset + 4);
    if (size < 8) break;
    var boxEnd = offset + size;
    if (boxEnd > end) boxEnd = end;
    if (CODEC_BOXES[type]) {
      return parseVisualSampleEntry(u8, offset + 8, boxEnd, type);
    }
    offset += size;
  }
  return null;
}

function parseVisualSampleEntry(u8, start, end, codec) {
  if (start + 28 > end) return null;
  var width = readUint16BE(u8, start + 24);
  var height = readUint16BE(u8, start + 26);
  return { width: width, height: height, codec: codec };
}

export function enhanceStreamQuality(streams, options) {
  if (!streams || streams.length === 0) return Promise.resolve(streams || []);
  var hlsProbeFn = (options && options.hlsProbe) || null;
  var promises = streams.map(function (stream) {
    if (!stream || !stream.url) return Promise.resolve(stream);
    var headers = stream.headers || {};
    var probePromise;
    if (stream.url.indexOf(".m3u8") >= 0) {
      if (hlsProbeFn) {
        probePromise = hlsProbeFn(stream.url, headers).catch(function () { return null; });
      } else {
        return Promise.resolve(stream);
      }
    } else if (stream.url.indexOf(".mp4") >= 0) {
      probePromise = probeMp4Resolution(stream.url, headers).catch(function () { return null; });
    } else {
      return Promise.resolve(stream);
    }
    return probePromise.then(function (result) {
      if (result && result.width > 0 && result.height > 0) {
        stream.quality = qualityFromResolution(result.width, result.height);
      }
      return stream;
    });
  });
  return Promise.all(promises);
}
