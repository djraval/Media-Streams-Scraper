#!/usr/bin/env node

/**
 * Simple HTTP server for local Nuvio app testing.
 * Serves static files from the repo root with CORS headers.
 * Modeled after phisher98's server.js.
 *
 * Usage: node server.js
 * Listens on port 3000 by default (override with PORT env var).
 */

var http = require("http");
var fs = require("fs");
var path = require("path");
var os = require("os");

var PORT = Number(process.env.PORT) || 3000;
var ROOT_DIR = __dirname;

var MIME_TYPES = {
  ".js": "application/javascript",
  ".json": "application/json",
  ".html": "text/html",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".map": "application/json",
};

function getLocalIPs() {
  var interfaces = os.networkInterfaces();
  var ips = [];
  for (var name in interfaces) {
    for (var i = 0; i < interfaces[name].length; i++) {
      var addr = interfaces[name][i];
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

function serveStatic(req, res) {
  // Parse URL — strip query string
  var urlPath = req.url.split("?")[0];

  // Prevent path traversal
  if (urlPath.indexOf("..") !== -1) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  // Default to manifest.json for root, or serve the requested file
  var filePath;
  if (urlPath === "/" || urlPath === "") {
    filePath = path.join(ROOT_DIR, "manifest.json");
  } else {
    filePath = path.join(ROOT_DIR, decodeURIComponent(urlPath));
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end("Not Found: " + urlPath);
      return;
    }

    var ext = path.extname(filePath).toLowerCase();
    var mime = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

var server = http.createServer(serveStatic);

server.listen(PORT, "0.0.0.0", function () {
  var ips = getLocalIPs();
  console.log("Nuvio provider server running on port " + PORT);
  console.log("");
  console.log("Manifest URL (use this in Nuvio app):");
  console.log("  http://localhost:" + PORT + "/manifest.json");
  if (ips.length > 0) {
    for (var i = 0; i < ips.length; i++) {
      console.log("  http://" + ips[i] + ":" + PORT + "/manifest.json");
    }
  }
  console.log("");
  console.log("Serving files from: " + ROOT_DIR);
  console.log("Press Ctrl+C to stop.");
});
