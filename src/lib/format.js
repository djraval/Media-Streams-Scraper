// Formatting helpers — bytes, duration, episode/movie labels, Nuvio stream objects.

export function formatBytes(bytes) {
  var value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";

  var units = ["B", "KB", "MB", "GB", "TB"];
  var size = value;
  var index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  var digits = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2;
  return size.toFixed(digits) + " " + units[index];
}

export function formatDuration(seconds) {
  var total = Math.round(Number(seconds) || 0);
  if (total <= 0) return "";
  var h = Math.floor(total / 3600);
  var m = Math.floor((total % 3600) / 60);
  var s = total % 60;
  if (h > 0) {
    return h + "h" + (m > 0 ? " " + m + "m" : "");
  }
  if (m > 0) {
    return m + "m" + (s > 0 ? " " + s + "s" : "");
  }
  return s + "s";
}

// Estimate quality from file size + runtime (bitrate heuristic).
// Nuvio's fetch polyfill has no binary access (no arrayBuffer, no axios),
// so we can't probe MP4 box headers. Instead we use MB-per-minute:
//   < 4 MB/min → 360p   (low-bitrate uploads, e.g. Kapil Vkprime)
//   4-20 MB/min → 720p  (typical Vk/MixDrop streams)
//   > 20 MB/min → 1080p (high-quality movie uploads)
// Calibrated against known samples:
//   Kapil S4E9 Vkprime: 210 MB / 62 min = 3.39 MB/min → 360p (real 640x360)
//   Kapil S4E9 Vkspeed: 822 MB / 62 min = 13.7 MB/min → 720p (real 1280x720)
//   Anupamaa E2060 Vk:  138 MB / 23 min = 6.0 MB/min  → 720p (real 1280x720)
//   Drishyam3 MixDrop:  673 MB / 157 min = 4.3 MB/min → 720p
export function estimateQualityFromSize(sizeBytes, runtimeMinutes) {
  var bytes = Number(sizeBytes);
  var minutes = Number(runtimeMinutes);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  var mbPerMin = bytes / (1024 * 1024) / minutes;
  if (mbPerMin < 4) return "360p";
  if (mbPerMin > 20) return "1080p";
  return "720p";
}

export function displayBackend(backend) {
  return String(backend || "source");
}

export function episodeLabel(request) {
  var season = String(request.season || 0).padStart(2, "0");
  var episode = String(request.episode || 0).padStart(2, "0");
  var parts = [request.title + " S" + season + "E" + episode];
  var epTitle = String(request.episodeTitle || "").trim();
  if (epTitle && !new RegExp("^episode\\s+" + request.episode + "$", "i").test(epTitle)) {
    parts.push(epTitle);
  }
  if (request.runtimeMinutes) {
    parts.push(request.runtimeMinutes + "m");
  }
  return parts.join(" - ");
}

export function movieLabel(request) {
  var parts = [request.title];
  if (request.airYear) {
    parts.push("(" + request.airYear + ")");
  }
  if (request.runtimeMinutes) {
    parts.push(request.runtimeMinutes + "m");
  }
  return parts.join(" - ");
}

export function mediaLabel(request) {
  if (request.mediaType === "movie") return movieLabel(request);
  return episodeLabel(request);
}

export function toNuvioStream(request, stream) {
  var name = stream.name || displayBackend(stream.sourceTag);
  var title = mediaLabel(request) + " - " + stream.quality + " " + String(stream.kind || "stream").toUpperCase();
  return {
    name: name,
    title: title,
    url: stream.url,
    quality: stream.quality,
    size: stream.size || "",
    headers: stream.headers || {},
  };
}
