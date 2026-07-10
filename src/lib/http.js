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

export function fetchFirstResult(fetchImpl, urls, options, select) {
  function next(index) {
    if (index >= urls.length) return Promise.resolve(null);
    return fetchText(fetchImpl, urls[index], options).then(function (text) {
      if (!text) return next(index + 1);
      var result = select(text, urls[index]);
      return result === null || result === undefined ? next(index + 1) : result;
    });
  }
  return next(0);
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
