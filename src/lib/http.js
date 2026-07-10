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
// or return empty). Go straight to axios which is provided by the sandbox and
// handles arraybuffer responses reliably. Falls back to fetch+arrayBuffer only
// if axios is unavailable (e.g. Node.js testing without axios installed).

export function fetchBinaryViaAxios(url, headers, rangeBytes) {
  try {
    var axios = require("axios");
    var rangeEnd = (rangeBytes || 65536) - 1;
    var config = {
      responseType: "arraybuffer",
      headers: Object.assign({}, headers || {}, { Range: "bytes=0-" + rangeEnd }),
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

export function fetchBinaryViaFetch(url, headers, rangeBytes) {
  var rangeEnd = (rangeBytes || 65536) - 1;
  var rangeHeaders = Object.assign({}, headers || {}, {
    Range: "bytes=0-" + rangeEnd,
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

export function fetchBinary(url, headers, rangeBytes) {
  // Try axios first — it's reliable in the Nuvio sandbox for binary data.
  // Only fall back to fetch+arrayBuffer if axios is not available.
  var axiosResult = fetchBinaryViaAxios(url, headers, rangeBytes);
  if (axiosResult) {
    return axiosResult;
  }
  if (typeof fetch !== "undefined") {
    return fetchBinaryViaFetch(url, headers, rangeBytes);
  }
  return Promise.resolve(null);
}
