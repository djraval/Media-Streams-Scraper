// HLS resolution probe — master playlist parser only.
// Fetches the m3u8, parses #EXT-X-STREAM-INF RESOLUTION tags, returns best variant.

export function probeHlsResolution(url, headers) {
  var fetchImpl = typeof fetch !== "undefined" ? fetch : null;
  if (!fetchImpl) return Promise.resolve(null);
  return fetchImpl(url, { headers: headers || {} })
    .then(function (response) {
      if (!response || response.ok === false) return null;
      return response.text();
    })
    .then(function (text) {
      if (!text || text.indexOf("#EXT-X-STREAM-INF") === -1) return null;
      var lines = String(text).split("\n");
      var bestWidth = 0;
      var bestHeight = 0;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line.indexOf("#EXT-X-STREAM-INF") === 0) {
          var resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
          if (resMatch) {
            var w = parseInt(resMatch[1], 10);
            var h = parseInt(resMatch[2], 10);
            if (h > bestHeight) {
              bestWidth = w;
              bestHeight = h;
            }
          }
        }
      }
      if (bestHeight > 0) return { width: bestWidth, height: bestHeight };
      return null;
    })
    .catch(function () { return null; });
}
