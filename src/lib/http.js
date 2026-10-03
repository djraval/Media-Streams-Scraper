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

// Per-invocation response cache. In-app every fetch is serialized through
// __native_fetch, so fetching the same URL twice (a hop page reached from two
// posts, a flow embed seen on both post and hop) doubles resolution time.
// Wrap the real fetch once per getStreams call: identical url+method+key
// headers share one request; each caller still gets a fresh Response-like
// whose .text()/.json() can be consumed independently.
export function cachingFetch(fetchImpl) {
  var cache = {};
  return function (url, options) {
    options = options || {};
    var h = options.headers || {};
    var key =
      (options.method || "GET") + "|" + url + "|" +
      (h["User-Agent"] || "") + "|" + (h.Referer || h.referer || "") + "|" +
      (typeof options.body === "string" ? options.body : "");
    if (!cache[key]) {
      cache[key] = fetchImpl(url, options)
        .then(function (res) {
          if (!res || res.ok === false) {
            return { ok: false, status: res ? res.status : 0 };
          }
          var hdrs = {};
          if (res.headers && typeof res.headers.get === "function") {
            ["content-range", "content-length", "content-type"].forEach(function (n) {
              hdrs[n] = res.headers.get(n);
            });
          }
          return res.text().then(function (body) {
            return { ok: true, status: res.status, statusText: res.statusText, url: res.url || url, body: body, headers: hdrs };
          });
        })
        .catch(function () {
          return { ok: false, status: 0 };
        });
    }
    return cache[key].then(function (cached) {
      if (!cached || !cached.ok) {
        return {
          ok: false,
          status: cached ? cached.status : 0,
          text: function () { return Promise.resolve(""); },
          json: function () { return Promise.resolve(null); },
          headers: { get: function () { return null; } },
        };
      }
      return {
        ok: true,
        status: cached.status,
        statusText: cached.statusText,
        url: cached.url,
        headers: {
          get: function (name) {
            return cached.headers[String(name).toLowerCase()] || null;
          },
        },
        text: function () { return Promise.resolve(cached.body); },
        json: function () {
          try {
            return Promise.resolve(JSON.parse(cached.body));
          } catch (e) {
            return Promise.resolve(null);
          }
        },
      };
    });
  };
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
