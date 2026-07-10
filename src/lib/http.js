// HTTP fetch helpers — text, binary, and JSON fetching with axios fallback.
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

export function fetchJson(fetchImpl, url) {
  return fetchImpl(url).then(function (response) {
    if (!response || response.ok === false) {
      var status = response ? response.status : "unknown";
      throw new Error("TMDB request failed: " + status);
    }
    return response.json();
  });
}

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

// --- Binary fetch ---
// In the Nuvio QuickJS sandbox, response.arrayBuffer() is unreliable (may hang
// or return empty). We try three strategies in order:
//   1. response.bytes() — newer Web API, returns Uint8Array directly
//   2. axios with responseType: "arraybuffer" — available via require() in sandbox
//   3. fetch + response.arrayBuffer() — last resort (works in Node.js testing)
// Each strategy is a separate function that returns a Promise<Uint8Array|null>
// or null if the strategy is not available at all.

export function fetchBinaryViaBytes(url, headers, start, end) {
  if (typeof fetch === "undefined") return null;
  // Quick-check: if Response.prototype.bytes is definitely not available, skip.
  // In QuickJS, Response may not be a global constructor, so we still try if
  // the check is inconclusive — the response object might have bytes() anyway.
  try {
    if (typeof Response !== "undefined" && typeof Response.prototype.bytes !== "function") {
      return null;
    }
  } catch (e) {
    // Response not accessible — try anyway (QuickJS may have bytes() on responses)
  }
  var rangeHeaders = Object.assign({}, headers || {}, { Range: "bytes=" + start + "-" + end });
  return fetch(url, { headers: rangeHeaders })
    .then(function (response) {
      if (!response || (response.ok === false && response.status !== 206 && response.status !== 200)) {
        return null;
      }
      if (typeof response.bytes === "function") {
        return response.bytes().then(function (u8) {
          if (u8 && u8.length >= 16) {
            return u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
          }
          return null;
        }).catch(function () { return null; });
      }
      return null;
    })
    .catch(function () { return null; });
}

export function fetchBinaryViaAxios(url, headers, start, end) {
  try {
    var axios = require("axios");
    var config = {
      responseType: "arraybuffer",
      headers: Object.assign({}, headers || {}, { Range: "bytes=" + start + "-" + end }),
    };
    return axios
      .get(url, config)
      .then(function (response) {
        if (response && response.data && response.data.byteLength >= 16) {
          return new Uint8Array(response.data);
        }
        return null;
      })
      .catch(function () { return null; });
  } catch (e) {
    return null;
  }
}

export function fetchBinaryViaFetch(url, headers, start, end) {
  if (typeof fetch === "undefined") return null;
  var rangeHeaders = Object.assign({}, headers || {}, {
    Range: "bytes=" + start + "-" + end,
  });
  return fetch(url, { headers: rangeHeaders })
    .then(function (response) {
      if (!response || (response.ok === false && response.status !== 206 && response.status !== 200)) {
        return null;
      }
      if (typeof response.arrayBuffer === "function") {
        return response.arrayBuffer();
      }
      return null;
    })
    .then(function (buffer) {
      if (buffer && buffer.byteLength >= 16) {
        return new Uint8Array(buffer);
      }
      return null;
    })
    .catch(function () { return null; });
}

// Fetch an arbitrary byte range [start, end] using the three strategies in order.
export function fetchBinaryRange(url, headers, start, end) {
  var p = fetchBinaryViaBytes(url, headers, start, end);
  if (!p) p = Promise.resolve(null);
  return p
    .then(function (result) {
      if (result) return result;
      var ap = fetchBinaryViaAxios(url, headers, start, end);
      return ap || Promise.resolve(null);
    })
    .then(function (result) {
      if (result) return result;
      var fp = fetchBinaryViaFetch(url, headers, start, end);
      return fp || Promise.resolve(null);
    })
    .then(function (result) {
      return result || null;
    });
}

// Backward-compatible wrapper: fetch first rangeBytes bytes from the URL.
export function fetchBinary(url, headers, rangeBytes) {
  var end = (rangeBytes || 65536) - 1;
  return fetchBinaryRange(url, headers, 0, end);
}

// Fetch the total file size via a Range: bytes=0-0 request.
// Parses Content-Range header (e.g. "bytes 0-0/1234567") to get total size.
// Falls back to Content-Length header if Content-Range is not present.
export function fetchFileSize(url, headers) {
  var rangeHeaders = Object.assign({}, headers || {}, { Range: "bytes=0-0" });

  // Try fetch first — headers work reliably even when body methods don't
  if (typeof fetch !== "undefined") {
    return fetch(url, { headers: rangeHeaders })
      .then(function (response) {
        if (!response) return 0;
        var cr = (response.headers && response.headers.get("content-range")) || "";
        var match = cr.match(/\/(\d+)$/);
        if (match) return Number(match[1]);
        var cl = (response.headers && response.headers.get("content-length")) || "";
        return Number(cl) || 0;
      })
      .catch(function () { return 0; });
  }

  // Fall back to axios
  try {
    var axios = require("axios");
    return axios
      .head(url, { headers: rangeHeaders })
      .then(function (response) {
        if (!response || !response.headers) return 0;
        var cr = response.headers["content-range"] || "";
        var match = cr.match(/\/(\d+)$/);
        if (match) return Number(match[1]);
        var cl = response.headers["content-length"] || "";
        return Number(cl) || 0;
      })
      .catch(function () { return 0; });
  } catch (e) {
    return Promise.resolve(0);
  }
}
