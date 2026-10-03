// Flow (tvlogy.to) HLS resolver — shared by source sites that embed
// flow.tvlogy.to/{embed,player,plyr,nflix}/{id} players.
// Extracted from desi-serials-to (which keeps its own copy for now).

import { UA } from "./constants.js";
import { resolveFetch, browserHeaders, fetchText } from "./http.js";
import { m3u8Candidates, nextUriLine, resolveRelativeUrl } from "./html.js";
import { decodeJuicyCodes } from "./packer.js";

function hlsQualityFromManifest(raw) {
  var matches = String(raw || "").matchAll(/RESOLUTION=\d+x(\d{3,4})/gi);
  var max = 0;
  for (var m of matches) {
    var height = Number(m[1]);
    if (height > max) {
      max = height;
    }
  }
  return max > 0 ? max + "p" : "unknown";
}

export function parseHlsMasterPlaylist(raw, baseUrl) {
  var variants = [];
  var lines = String(raw || "").split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      var resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
      var avgBwMatch = line.match(/AVERAGE-BANDWIDTH=(\d+)/i);
      var bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      var height = resMatch ? Number(resMatch[1]) : 0;
      var bandwidth = avgBwMatch ? Number(avgBwMatch[1]) : bwMatch ? Number(bwMatch[1]) : 0;
      // JuicyCodes (Flow/tvlogy.to) packager reports BANDWIDTH 1000x too high
      // (e.g. 448265000 instead of 448265 bps). No web stream exceeds ~50 Mbps,
      // so anything above 100 Mbps is this bug — divide by 1000 to recover the
      // real value. If still absurd after correction, discard entirely.
      if (bandwidth > 100000000) {
        bandwidth = Math.round(bandwidth / 1000);
        if (bandwidth > 100000000) bandwidth = 0;
      }
      var urlLine = nextUriLine(lines, i + 1);
      if (urlLine) {
        variants.push({
          url: resolveRelativeUrl(baseUrl, urlLine),
          height: height,
          bandwidth: bandwidth,
        });
      }
    }
  }
  variants.sort(function (a, b) {
    return (b.height || b.bandwidth) - (a.height || a.bandwidth);
  });
  return variants;
}

export function flowVariantLabel(url) {
  var match = String(url || "").match(/flow\.tvlogy\.to\/([a-z0-9]+)\//i);
  if (!match) {
    return "";
  }
  var variant = match[1].toLowerCase();
  if (variant.startsWith("embed")) {
    return "embed";
  }
  if (variant.startsWith("plyr")) {
    return "plyr";
  }
  if (variant.startsWith("nflix")) {
    return "nflix";
  }
  if (variant.startsWith("player")) {
    return "player";
  }
  return variant;
}

function buildFlowStream(quality, size, duration, playerUrl, streamHeaders, url) {
  return {
    backend: "flow",
    kind: "hls",
    quality: quality,
    url: url,
    size: size,
    duration: duration,
    sourceTag: flowVariantLabel(playerUrl),
    headers: streamHeaders,
  };
}

// ponytail: quality from master RESOLUTION only. Skip media-playlist + segment
// size sampling (~15 range requests) — size/duration never reach Nuvio anyway.
export function resolveFlowPlayer(playerUrl, refererUrl, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var streamHeaders = { Referer: playerUrl, "User-Agent": UA };
  return fetchText(fetchImpl, playerUrl, browserHeaders(refererUrl))
    .then(function (player) {
      if (!player) {
        return null;
      }
      // Scan both direct HTML and JuicyCodes-decoded output for m3u8 URLs.
      var directCandidates = m3u8Candidates(player);
      var decodedCandidates = m3u8Candidates(decodeJuicyCodes(player));
      var masterUrl = directCandidates[0] || decodedCandidates[0] || "";
      if (!masterUrl) {
        return null;
      }
      return fetchText(fetchImpl, masterUrl, browserHeaders(playerUrl)).then(function (manifest) {
        var variants = parseHlsMasterPlaylist(manifest, masterUrl);
        var quality =
          variants.length > 0 && variants[0].height > 0
            ? variants[0].height + "p"
            : hlsQualityFromManifest(manifest);
        var stream = buildFlowStream(quality, "", 0, playerUrl, streamHeaders, masterUrl);
        stream.bandwidth = variants.length > 0 ? variants[0].bandwidth : 0;
        return stream;
      });
    });
}
