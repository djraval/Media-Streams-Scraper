// VidUp resolver — vidup.site embed → Blogger video → googlevideo MP4 URLs.
// Flow:
// 1. Fetch vidup.site/play?cd=... page
// 2. Extract Blogger token from blogger.com/video.g?token=... iframe
// 3. Fetch blogger.com/video.g?token=... page → extract f.sid + bl session params
// 4. POST to Blogger batchexecute API (RPC ID: WcwnYd) with session params
// 5. Parse response for googlevideo MP4 URLs (itag 18=360p, 22=720p)
//
// googlevideo URLs are IP-bound (same as Flow HLS) — no server-side probing.

import { UA, BROWSER_HEADERS } from "./constants.js";
import { fetchText } from "./http.js";

var VIDUP_HOSTS = ["vidup.site"];
var BLOGGER_VIDEO_PAGE = "https://www.blogger.com/video.g?token=";
var BLOGGER_BATCH_BASE = "https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute";
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

// Extract session parameters from the Blogger video.g page HTML.
// The page contains "FdrFJe":"<formSessionId>" and "cfb2h":"<blogId>".
function extractBloggerSession(html) {
  var text = String(html || "");
  var sidMatch = text.match(/"FdrFJe":"([^"]+)"/);
  var blMatch = text.match(/"cfb2h":"([^"]+)"/);
  return {
    formSessionId: sidMatch ? sidMatch[1] : "",
    blogId: blMatch ? blMatch[1] : "",
  };
}

// Call the Blogger batchexecute API and return the raw response text.
// Requires the form session ID and blog ID extracted from the video.g page.
function bloggerBatchExecute(fetchImpl, token, session) {
  // Build URL with required query parameters.
  var reqid = String((Date.now() / 1000) % 86400 | 0);
  var url =
    BLOGGER_BATCH_BASE +
    "?rpcids=" + BLOGGER_RPC_ID +
    "&source-path=%2Fvideo.g" +
    "&f.sid=" + encodeURIComponent(session.formSessionId) +
    "&bl=" + encodeURIComponent(session.blogId) +
    "&hl=en-US&_reqid=" + reqid + "&rt=c";

  // Body: f.req=[[["WcwnYd","[\"TOKEN\",\"\",0]",null,"generic"]]]
  // The inner RPC parameter is a JSON array: ["token", "", 0]
  // Note: three levels of array nesting — [[["WcwnYd",...]]]
  var innerParam = '["' + token + '","",0]';
  var reqPayload = JSON.stringify([[[BLOGGER_RPC_ID, innerParam, null, "generic"]]]);
  var body = "f.req=" + encodeURIComponent(reqPayload);

  return fetchImpl(url, {
    method: "POST",
    headers: Object.assign({}, BROWSER_HEADERS, {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Referer": "https://www.blogger.com/",
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

  // Decode \\u003d → =, \\u0026 → & etc. (response uses double-escaped JSON)
  text = text.replace(/\\\\u003d/g, "=").replace(/\\\\u0026/g, "&");
  text = text.replace(/\\\\u003f/g, "?").replace(/\\\\u002f/g, "/");
  // Also handle single-backslash variants for robustness
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
      if (!html) return { token: "", session: null };
      var token = extractBloggerToken(html);
      if (!token) return { token: "", session: null };

      // Step 2: Fetch blogger.com/video.g page to get session params
      return fetchText(fetchImpl, BLOGGER_VIDEO_PAGE + token, { headers: BROWSER_HEADERS })
        .then(function (bloggerHtml) {
          if (!bloggerHtml) return { token: token, session: null };
          return { token: token, session: extractBloggerSession(bloggerHtml) };
        });
    })
    .then(function (result) {
      if (!result.token || !result.session || !result.session.formSessionId) return [];

      // Step 3: Call batchexecute API with session params
      return bloggerBatchExecute(fetchImpl, result.token, result.session);
    })
    .then(function (responseText) {
      if (!responseText) return [];

      // Step 4: Parse response for googlevideo URLs
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
