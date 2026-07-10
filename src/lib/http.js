// HTTP fetch helpers — text, JSON, content-length.
// Works in both Node.js (for testing) and the Nuvio QuickJS sandbox.

import { BROWSER_HEADERS } from "./constants.js";

export function resolveFetch(options) {
  return (options && options.fetchImpl) || (typeof fetch !== "undefined" ? fetch : null);
}

export function browserHeaders(referer) {
  return { headers: Object.assign({}, BROWSER_HEADERS, { Referer: referer }) };
}

export function fetchText(fetchImpl, url, options) {
  return fetchImpl(url, options || {})
    .then(function (response) {
      if (!response || response.ok === false) {
        return null;
      }
      return response.text();
    })
    .catch(function () { return null; });
}

// Same as fetchText but with AbortSignal.timeout when available (Node 18+ / modern browsers).
// Used for speculative page-URL probes that often hang on 404 hosts.
export function fetchTextTimeout(fetchImpl, url, options, ms) {
  options = options || {};
  ms = ms || 4000;
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    options = Object.assign({}, options, { signal: AbortSignal.timeout(ms) });
  }
  return fetchText(fetchImpl, url, options);
}

export function fetchJson(fetchImpl, url) {
  return fetchImpl(url).then(function (response) {
    if (!response || response.ok === false) {
      var status = response ? response.status : "unknown";
      throw new Error("TMDB request failed: " + status);
    }
    return response.json();
  });
}

// Size via Range: bytes=0-0 + Content-Range (e.g. "bytes 0-0/1234567").
export function fetchContentLength(fetchImpl, url, headers) {
  return fetchImpl(url, { method: "GET", headers: Object.assign({}, headers || {}, { Range: "bytes=0-0" }) })
    .then(function (response) {
      if (!response || response.ok === false) return 0;
      var cr = (response.headers && response.headers.get("content-range")) || "";
      var match = cr.match(/\/(\d+)$/);
      if (match) {
        if (typeof response.arrayBuffer === "function") {
          response.arrayBuffer().catch(function () {});
        }
        return Number(match[1]);
      }
      return Number((response.headers && response.headers.get("content-length")) || 0) || 0;
    })
    .catch(function () { return 0; });
}

// Binary range for MP4 box parsing. Prefer axios (works in Nuvio sandbox); fetch arrayBuffer for Node.
// Nuvio's fetch polyfill only exposes text/json body — arrayBuffer is NOT available there.
export function fetchBinaryRange(url, headers, start, end) {
  var rangeHeaders = Object.assign({}, headers || {}, { Range: "bytes=" + start + "-" + end });

  function viaAxios() {
    try {
      var axios = require("axios");
      return axios
        .get(url, { responseType: "arraybuffer", headers: rangeHeaders, timeout: 8000 })
        .then(function (response) {
          if (response && response.data && response.data.byteLength >= 16) {
            return new Uint8Array(response.data);
          }
          return null;
        })
        .catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function viaFetch() {
    if (typeof fetch === "undefined") return Promise.resolve(null);
    return fetch(url, { headers: rangeHeaders })
      .then(function (response) {
        if (!response || (response.ok === false && response.status !== 206 && response.status !== 200)) {
          return null;
        }
        if (typeof response.arrayBuffer !== "function") return null;
        return response.arrayBuffer().then(function (buf) {
          if (buf && buf.byteLength >= 16) return new Uint8Array(buf);
          return null;
        });
      })
      .catch(function () { return null; });
  }

  return viaAxios().then(function (u8) {
    if (u8) return u8;
    return viaFetch();
  });
}
