// Upbolt HLS relay — fetches upstream with node's undici fingerprint (passes the
// edge fingerprint gate that rejects curl/ffmpeg/okhttp), rewrites absolute
// playlist URLs back through this proxy, and pipes segment bytes through.
// Usage: GET /p?u=<urlencoded upstream URL>
var http = require('http');
var ALLOWED = /\.upbolt\.to$/i;

function respond(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

var server = http.createServer(function (req, res) {
  var u;
  try { u = new URL(req.url, 'http://x'); } catch (e) { return respond(res, 400, 'bad url'); }
  if (u.pathname === '/') return respond(res, 200, 'upbolt-relay up');
  if (u.pathname !== '/p') return respond(res, 404, 'not found');
  var target = u.searchParams.get('u');
  if (!target) return respond(res, 400, 'missing u');
  var t;
  try { t = new URL(target); } catch (e) { return respond(res, 400, 'bad u'); }
  if (!ALLOWED.test(t.hostname)) return respond(res, 403, 'host not allowed');

  var hdrs = { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' };
  if (req.headers.range) hdrs['Range'] = req.headers.range;

  fetch(target, { headers: hdrs, redirect: 'follow' }).then(function (r) {
    var ct = r.headers.get('content-type') || '';
    if (/mpegurl|application\/x-mpeg|vnd\.apple/i.test(ct) || /\.m3u8(\?|$)/i.test(t.pathname)) {
      return r.text().then(function (body) {
        var base = u.searchParams.get('base') || '';
        var proto = req.headers['x-forwarded-proto'] || 'http';
        var host = req.headers['x-forwarded-host'] || req.headers.host;
        var self = proto + '://' + host + '/p?u=';
        var out = body.replace(/https?:\/\/[^\s"'()]+/g, function (m) {
          return self + encodeURIComponent(m);
        });
        res.writeHead(r.status, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        });
        res.end(out);
      });
    }
    // binary passthrough (.ts segments, aac, keys)
    var oh = {
      'Content-Type': ct || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    };
    ['content-length', 'content-range'].forEach(function (h) {
      var v = r.headers.get(h); if (v) oh[h] = v;
    });
    res.writeHead(r.status, oh);
    return r.body.pipeTo(new (require('stream/web').WritableStream)({
      write: function (chunk) { res.write(Buffer.from(chunk)); },
      close: function () { res.end(); }
    })).catch(function () { res.end(); });
  }).catch(function (e) {
    respond(res, 502, 'upstream ' + e.message);
  });
});

server.listen(8787, '0.0.0.0', function () { console.log('listening :8787'); });
