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

    if (provider === "desi-serials-to" || provider === "desi-flow") {
      if (url.indexOf("/?s=test-show+") !== -1) return response(url, '<a href="https://www.desi-serials.to/test-show-episode-2nd-january-2025-watch-online/1/">episode</a>', 200);
      if (url.indexOf("/test-show-episode-") !== -1) return response(url, '<a href="https://tvarticles.org/vidd.php?id=1">player</a>', 200);
      if (url.indexOf("tvarticles.org/vidd.php?id=1") !== -1) {
        var player = provider === "desi-flow" ? "https://flow.tvlogy.to/embed020A/test/" : "https://vkspeed.com/embed-test.html";
        return response(url, '<iframe src="' + player + '"></iframe>', 200);
      }
      if (url.indexOf("flow.tvlogy.to/embed020A/test/") !== -1) return response(url, 'https://hls.test/master.m3u8', 200);
      if (url.indexOf("hls.test/master.m3u8") !== -1) return response(url, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=720x480\nvideo.m3u8', 200);
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

    if (hasCanonical !== false && (provider === "mixdrop-desi" || provider === "streamtape-desi" || provider === "streamtape-size") &&
        url.indexOf("test-show-2025-ep-09-hindi-season-1-watch-online-hd-print-free-download/") !== -1) {
      var page = provider === "streamtape-size" ? '<a href="https://streamtape.com/v/abc">Streamtape 720p</a>' : "<html>canonical episode page without this host</html>";
      return response(url, page, 200);
    }
    if (provider === "streamtape-size" && url.indexOf("streamtape.com/v/abc") !== -1) return response(url, "getElementById('norobotlink').innerHTML = '//streamtape.com/get_video?id=' + ('xxxxabc').substring(4)", 200);
    if (provider === "streamtape-size" && url.indexOf("streamtape.com/get_video") !== -1) return response(url, "", 302, { location: "https://cdn.test/stream.mp4" });
    if (provider === "streamtape-size" && url.indexOf("cdn.test/stream.mp4") !== -1) return response(url, "x", 206, { "content-range": "bytes 0-0/500000000" });
    if (url.indexOf("ulluhd.com/") !== -1) return response(url, "<html></html>", 200);
    return response(url, "", 404);
  }
  fakeFetch.calls = calls;
  return fakeFetch;
}

async function check(provider, maxRequests, hasCanonical) {
  var fakeFetch = fakeFetchFor(provider, hasCanonical);
  var moduleName = provider === "desi-flow" ? "desi-serials-to" : provider === "streamtape-size" ? "streamtape-desi" : provider;
  global.fetch = fakeFetch;
  delete require.cache[require.resolve("./providers/" + moduleName + ".js")];
  var streams = await require("./providers/" + moduleName + ".js").getStreams("1", "tv", 1, 9);
  assert(fakeFetch.calls.length <= maxRequests, provider + " made " + fakeFetch.calls.length + " requests; expected <= " + maxRequests);
  return streams;
}

(async function () {
  var mp4 = await check("desi-serials-to", 7);
  assert.strictEqual(mp4[0].quality, "720p • 1.1 Mbps");
  assert.strictEqual(mp4[0].size, "477 MB");
  var flow = await check("desi-flow", 7);
  assert.strictEqual(flow[0].quality, "480p • 0.80 Mbps");
  assert.strictEqual(flow[0].size, "343 MB");
  await check("desiruleztv-net", 6);
  await check("desitvserials-se", 6);
  await check("mixdrop-desi", 4);
  await check("streamtape-desi", 7);
  var streamtape = await check("streamtape-size", 7);
  assert.strictEqual(streamtape[0].quality, "720p • 1.1 Mbps");
  assert.strictEqual(streamtape[0].size, "477 MB");
  await check("mixdrop-desi", 10, false);
  await check("streamtape-desi", 12, false);
  console.log("performance request-budget checks passed");
})().catch(function (error) {
  console.error(error.message);
  process.exitCode = 1;
});
