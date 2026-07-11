// VidUp resolver — vidup.site embed → Blogger video → googlevideo MP4 URLs.
// Flow:
// 1. Fetch vidup.site/play?cd=... page
// 2. Extract Blogger token from blogger.com/video.g?token=... iframe
// 3. POST to Blogger batchexecute API (RPC ID: WcwnYd)
// 4. Parse response for googlevideo MP4 URLs (itag 18=360p, 22=720p)
//
// googlevideo URLs are IP-bound (same as Flow HLS) — no server-side probing.

import { UA, BROWSER_HEADERS } from "./constants.js";
import { fetchText } from "./http.js";

var VIDUP_HOSTS = ["vidup.site"];
var BLOGGER_BATCH_URL = "https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute";
var BLOGGER_RPC_ID = "WcwnYd";

// Itag → quality mapping for Blogger/googlevideo streams.
var ITAG_QUALITY = {
  18: "360p",
  22: "720p",
};

// Check if a URL is a vidup.site embed URL.
export function isVidUpUrl(url) {
  var str = String(url || "");
  for (var i = 0; i < VIDUP_HOSTS.length; i++) {
    if (str.indexOf(VIDUP_HOSTS[i]) !== -1) return true;
  }
  return false;
}

// Extract the Blogger video token from a vidup.site page HTML.
// The page contains an iframe: blogger.com/video.g?token=TOKEN
function extractBloggerToken(html) {
  var match = String(html || "").match(/blogger\.com\/video\.g\?token=([^"&]+)/);
  return match ? match[1] : "";
}

// Call the Blogger batchexecute API and return the raw response text.
// The API returns a response prefixed with )]}' XSS guard, then the JSON payload.
function bloggerBatchExecute(fetchImpl, token) {
  // Body: f.req=[[["WcwnYd","[\"TOKEN\"]",null,"generic"]]]
  var innerParam = '["' + token + '"]';
  var reqPayload = JSON.stringify([[BLOGGER_RPC_ID, innerParam, null, "generic"]]);
  var body = "f.req=" + encodeURIComponent(reqPayload);

  return fetchImpl(BLOGGER_BATCH_URL, {
    method: "POST",
    headers: Object.assign({}, BROWSER_HEADERS, {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": "https://www.blogger.com/video.g",
      "X-Same-Domain": "1",
    }),
    body: body,
  })
    .then(function (response) {
      if (!response || response.ok === false) return null;
      return response.text();
    })
    .catch(function () { return null; });
}

// Parse the batchexecute response and extract googlevideo MP4 URLs.
// Returns: [{url, itag, quality}] sorted by quality descending.
function parseBloggerVideoUrls(responseText) {
  var text = String(responseText || "");
  if (!text) return [];

  // Decode \u003d → =, \u0026 → & etc.
  text = text.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
  text = text.replace(/\\u003f/g, "?").replace(/\\u002f/g, "/");

  // Extract all googlevideo URLs with their itag values
  var urlRe = /https:\/\/rr\d+---sn-[a-z0-9]+\.googlevideo\.com\/videoplayback[^"]+/g;
  var itagRe = /itag=(\d+)/;
  var results = [];
  var match;
  while ((match = urlRe.exec(text)) !== null) {
    var url = match[0];
    var itagMatch = url.match(itagRe);
    var itag = itagMatch ? Number(itagMatch[1]) : 0;
    var quality = ITAG_QUALITY[itag] || "unknown";
    results.push({ url: url, itag: itag, quality: quality });
  }

  // Dedupe by URL and sort by itag descending (720p first)
  var seen = new Set();
  var deduped = [];
  for (var i = 0; i < results.length; i++) {
    if (!seen.has(results[i].url)) {
      seen.add(results[i].url);
      deduped.push(results[i]);
    }
  }
  deduped.sort(function (a, b) { return b.itag - a.itag; });
  return deduped;
}

// Resolve a vidup.site embed URL to Blogger video MP4 streams.
// Returns: Promise<Array<{url, quality, name, kind, sourceTag}>>
export function resolveVidUpEmbed(fetchImpl, vidupUrl) {
  // Step 1: Fetch vidup.site page to get Blogger token
  return fetchText(fetchImpl, vidupUrl, { headers: BROWSER_HEADERS })
    .then(function (html) {
      if (!html) return [];
      var token = extractBloggerToken(html);
      if (!token) return [];

      // Step 2: Call batchexecute API
      return bloggerBatchExecute(fetchImpl, token);
    })
    .then(function (responseText) {
      if (!responseText) return [];

      // Step 3: Parse response for googlevideo URLs
      var urls = parseBloggerVideoUrls(responseText);
      return urls.map(function (item) {
        return {
          url: item.url,
          quality: item.quality,
          name: "Blogger",
          kind: "mp4",
          sourceTag: "blogger",
        };
      });
    })
    .catch(function () { return []; });
}
