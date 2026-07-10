const assert = require("assert");

function response(url, body, status, headers) {
  headers = headers || {};
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status: status,
    url: url,
    headers: { get: function (name) { return headers[String(name).toLowerCase()] || null; } },
    text: function () { return Promise.resolve(body); },
    json: function () { return Promise.resolve(JSON.parse(body)); },
  });
}

function fakeFetchFor(provider, hasCanonical) {
  var calls = [];
  function fakeFetch(url) {
    url = String(url);
    calls.push(url);
    if (/api\.themoviedb\.org\/3\/tv\/1\/season\/1\/episode\/9/.test(url)) {
      return response(url, JSON.stringify({ air_date: "2025-01-02", name: "Episode 9", runtime: 60 }), 200);
    }
    if (/api\.themoviedb\.org\/3\/tv\/1\?/.test(url)) {
      return response(url, JSON.stringify({ name: "Test Show", networks: [{ name: "Netflix" }], episode_run_time: [60] }), 200);
    }

    if (provider === "desi-serials-to") {
      if (url.indexOf("/?s=test-show+") !== -1) return response(url, '<a href="https://www.desi-serials.to/test-show-episode-2nd-january-2025-watch-online/1/">episode</a>', 200);
      if (url.indexOf("/test-show-episode-") !== -1) return response(url, '<a href="https://tvarticles.org/vidd.php?id=1">player</a>', 200);
      if (url.indexOf("tvarticles.org/vidd.php?id=1") !== -1) return response(url, '<iframe src="https://vkspeed.com/embed-test.html"></iframe>', 200);
    }

    if (provider === "desiruleztv-net") {
      if (url.indexOf("/?s=test-show+") !== -1) return response(url, '<a href="https://desiruleztv.net/test-show-2nd-january-2025/">episode</a>', 200);
      if (url.indexOf("desiruleztv.net/test-show-2nd-") !== -1) return response(url, '<iframe src="https://vkspeed.com/embed-test.html"></iframe>', 200);
    }

    if (provider === "desitvserials-se") {
      if (url.indexOf("/?s=test-show+") !== -1) return response(url, '<a href="https://desitvserials.se/test-show-2nd-january-2025/">episode</a>', 200);
      if (url.indexOf("desitvserials.se/test-show-2nd-") !== -1) return response(url, '<iframe src="https://vkspeed.com/embed-test.html"></iframe>', 200);
    }

    if (url.indexOf("vkspeed.com/embed-test.html") !== -1) {
      return response(url, 'sources: [{file:"https://cdn.test/v.mp4",label:"360"}]', 200);
    }
    if (url.indexOf("cdn.test/v.mp4") !== -1) {
      return response(url, "x", 206, { "content-range": "bytes 0-0/500000000" });
    }

    if (hasCanonical !== false && (provider === "mixdrop-desi" || provider === "streamtape-desi") &&
        url.indexOf("test-show-2025-ep-09-hindi-season-1-watch-online-hd-print-free-download/") !== -1) {
      return response(url, "<html>canonical episode page without this host</html>", 200);
    }
    if (url.indexOf("ulluhd.com/") !== -1) return response(url, "<html></html>", 200);
    return response(url, "", 404);
  }
  fakeFetch.calls = calls;
  return fakeFetch;
}

async function check(provider, maxRequests, hasCanonical) {
  var fakeFetch = fakeFetchFor(provider, hasCanonical);
  global.fetch = fakeFetch;
  delete require.cache[require.resolve("./providers/" + provider + ".js")];
  await require("./providers/" + provider + ".js").getStreams("1", "tv", 1, 9);
  assert(fakeFetch.calls.length <= maxRequests, provider + " made " + fakeFetch.calls.length + " requests; expected <= " + maxRequests);
}

(async function () {
  await check("desi-serials-to", 7);
  await check("desiruleztv-net", 6);
  await check("desitvserials-se", 6);
  await check("mixdrop-desi", 4);
  await check("streamtape-desi", 7);
  await check("mixdrop-desi", 10, false);
  await check("streamtape-desi", 12, false);
  console.log("performance request-budget checks passed");
})().catch(function (error) {
  console.error(error.message);
  process.exitCode = 1;
});
