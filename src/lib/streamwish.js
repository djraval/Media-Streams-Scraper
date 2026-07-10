// StreamWish resolver — no crypto, just JS deobfuscation.
// Flow: embed page → mirror redirect → player page → Dean Edwards P.A.C.K.E.R. → unpack → regex m3u8.
// main.js contains RC4-obfuscated server lists (dmca/main/rules arrays).
// The player page uses P.A.C.K.E.R. which we already unpack with src/lib/packer.js.
// After unpacking, m3u8 URLs are in a `links` object: "hls4":"...", "hls3":"...", "hls2":"...".

import { UA, BROWSER_HEADERS } from "./constants.js";
import { fetchText } from "./http.js";
import { unpack } from "./packer.js";

var STREAMWISH_HOSTS = [
  "streamwish.com", "streamwish.to", "strcloud.club", "stape.fun",
  "streamtape.xyz", "streamtape.com", "streamtape.to",
  "wishembed.pro", "streamwish.org", "sfastwish.com",
  "strwish.com", "awish.pro", "embedwish.com", "swhoi.com",
  "hgcloud.to", "hglink.to", "mwish.pro", "dwish.pro",
  "streamwish.site", "streamwish.fun",
];

// Mirror server lists (from decoded main.js — updated periodically).
// dmca servers: used when current host is NOT in rules.
// main servers: used when current host IS in rules.
var DMCA_SERVERS = [
  "hgplaycdn.com", "hglamioz.com", "niramirus.com", "playnixes.com", "medixiru.com",
];
var MAIN_SERVERS = [
  "hanerix.com", "audinifer.com", "vibuxer.com", "masukestin.com",
];
var RULES_SERVERS = [
  "dhcplay.com", "hglink.to", "hgcloud.to",
];

// Check if URL is a StreamWish embed.
export function isStreamWishUrl(url) {
  var str = String(url || "");
  for (var i = 0; i < STREAMWISH_HOSTS.length; i++) {
    if (str.indexOf(STREAMWISH_HOSTS[i]) !== -1) return true;
  }
  return false;
}

// Extract file code from StreamWish URL.
export function extractStreamWishCode(url) {
  var match = String(url || "").match(/\/(?:e|d|v)\/([0-9a-zA-Z]+)/);
  return match ? match[1] : null;
}

// Extract file code and path from StreamWish URL.
function extractPath(url) {
  var match = String(url || "").match(/\/(e|d|v)\/([0-9a-zA-Z]+)([^\s"?]*)/);
  if (!match) return null;
  return { type: match[1], code: match[2], suffix: match[3] || "" };
}

// Pick a mirror server for the given embed URL.
function pickMirror(url) {
  var str = String(url || "");
  var inRules = false;
  for (var i = 0; i < RULES_SERVERS.length; i++) {
    if (str.indexOf(RULES_SERVERS[i]) !== -1) { inRules = true; break; }
  }
  var servers = inRules ? MAIN_SERVERS : DMCA_SERVERS;
  return servers[Math.floor(Math.random() * servers.length)];
}

// Extract m3u8 URLs from unpacked player JS.
function extractM3u8Urls(unpacked) {
  var urls = [];

  // Pattern 1: links object with hls keys
  var hlsMatches = String(unpacked).match(/"hls[234]"\s*:\s*"([^"]+)"/g);
  if (hlsMatches) {
    for (var i = 0; i < hlsMatches.length; i++) {
      var valMatch = hlsMatches[i].match(/"hls[234]"\s*:\s*"([^"]+)"/);
      if (valMatch && valMatch[1]) {
        var u = valMatch[1];
        // Relative URLs need a base — skip them, prefer absolute
        if (u.indexOf("http") === 0) {
          urls.push(u);
        }
      }
    }
  }

  // Pattern 2: direct m3u8 URLs
  if (urls.length === 0) {
    var directMatches = String(unpacked).match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g);
    if (directMatches) {
      urls = directMatches;
    }
  }

  // Pattern 3: file:"..." in sources
  if (urls.length === 0) {
    var fileMatches = String(unpacked).match(/file\s*:\s*"(https?:\/\/[^"]+)"/g);
    if (fileMatches) {
      for (var j = 0; j < fileMatches.length; j++) {
        var fm = fileMatches[j].match(/file\s*:\s*"(https?:\/\/[^"]+)"/);
        if (fm) urls.push(fm[1]);
      }
    }
  }

  // Dedupe
  var seen = {};
  return urls.filter(function (u) {
    if (seen[u]) return false;
    seen[u] = true;
    return true;
  });
}

// Extract quality label from unpacked JS (e.g., "720p", "480p").
function extractQualityFromUnpacked(unpacked) {
  var labelMatch = String(unpacked).match(/label\s*:\s*"([^"]+)"/);
  if (labelMatch) return labelMatch[1];
  var heightMatch = String(unpacked).match(/height\s*:\s*(\d+)/);
  if (heightMatch) return heightMatch[1] + "p";
  return "";
}

// Resolve a StreamWish embed URL to stream(s).
// Returns Promise<Array<{ url, quality, kind }>>.
export function resolveStreamWish(fetchImpl, embedUrl, refererUrl) {
  var pathInfo = extractPath(embedUrl);
  if (!pathInfo) return Promise.resolve([]);

  var code = pathInfo.code;

  // Step 1: Try fetching the embed page directly — some hosts serve the player page.
  // Step 2: If it's a shell page (main.js redirect), fetch from a mirror server.
  var headers = Object.assign({}, BROWSER_HEADERS);
  if (refererUrl) headers.Referer = refererUrl;

  function tryResolveFromPage(pageUrl) {
    return fetchText(fetchImpl, pageUrl, { headers: headers }).then(function (html) {
      if (!html) return null;
      // Check for expired file
      if (html.indexOf("File is no longer available") !== -1 || html.indexOf("no longer available") !== -1) {
        return null;
      }
      // Check for shell page (main.js redirect) — ~452 bytes with <script src="/main.js">
      if (html.length < 1000 && html.indexOf("main.js") !== -1) {
        return "shell";
      }
      // Look for P.A.C.K.E.R. encoded JS
      if (html.indexOf("eval(function(p,a,c,k,e,") !== -1) {
        var unpacked = unpack(html);
        if (unpacked) {
          var urls = extractM3u8Urls(unpacked);
          if (urls.length > 0) {
            var quality = extractQualityFromUnpacked(unpacked);
            return urls.map(function (u) {
              return {
                url: u,
                quality: quality,
                kind: "hls",
              };
            });
          }
        }
      }
      // Look for direct m3u8 URLs in the HTML
      var directUrls = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g);
      if (directUrls && directUrls.length > 0) {
        return directUrls.map(function (u) {
          return { url: u, quality: "", kind: "hls" };
        });
      }
      return null;
    });
  }

  // Try the original embed URL first
  return tryResolveFromPage(embedUrl).then(function (result) {
    if (result && result !== "shell" && Array.isArray(result)) {
      return result;
    }

    // Shell page or no result — try mirror servers
    var mirrorHost = pickMirror(embedUrl);
    var mirrorUrl = "https://" + mirrorHost + "/e/" + code;

    return tryResolveFromPage(mirrorUrl).then(function (mirrorResult) {
      if (mirrorResult && mirrorResult !== "shell" && Array.isArray(mirrorResult)) {
        return mirrorResult;
      }

      // Try other mirrors
      var allMirrors = DMCA_SERVERS.concat(MAIN_SERVERS);
      function tryNextMirror(index) {
        if (index >= allMirrors.length) return Promise.resolve([]);
        if (allMirrors[index] === mirrorHost) return tryNextMirror(index + 1);
        var url = "https://" + allMirrors[index] + "/e/" + code;
        return tryResolveFromPage(url).then(function (res) {
          if (res && res !== "shell" && Array.isArray(res)) return res;
          return tryNextMirror(index + 1);
        });
      }
      return tryNextMirror(0);
    });
  });
}
