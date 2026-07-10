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

// Bitrate label from file size + runtime.
function formatMbps(mbps) {
  if (mbps >= 10) return mbps.toFixed(0) + " Mbps";
  if (mbps >= 1) return mbps.toFixed(1) + " Mbps";
  return mbps.toFixed(2) + " Mbps";
}

export function bitrateLabel(sizeBytes, runtimeMinutes) {
  var bytes = Number(sizeBytes);
  var minutes = Number(runtimeMinutes);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return formatMbps((bytes * 8) / (minutes * 60) / 1000000);
}

// Resolution is NOT estimated from bitrate — bitrate is a quality indicator, not
// a resolution indicator. A 720p file at 1.5 Mbps is still 720p (just compressed).
// Providers set stream.quality from filename/page labels; Flow uses manifest RESOLUTION.
// Bitrate and size are shown separately for users to judge actual visual quality.

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
  var resolution = stream.quality;
  var bitrate = stream.bandwidth ? formatMbps(stream.bandwidth / 1000000) : bitrateLabel(stream.sizeBytes, request.runtimeMinutes);
  if (stream.bandwidth && request.runtimeMinutes && !stream.size) {
    stream.size = formatBytes(stream.bandwidth * request.runtimeMinutes * 60 / 8);
  }
  // Normalize resolution: drop falsy/empty/"0"/"unknown" — don't print it
  var hasRes = resolution && String(resolution) !== "0" && String(resolution).toLowerCase() !== "unknown";
  var parts = [];
  if (hasRes) parts.push(resolution);
  if (bitrate) parts.push(bitrate);
  stream.quality = parts.join(" • ");
  var name = stream.name || displayBackend(stream.sourceTag);
  var title = mediaLabel(request);
  if (stream.quality) title += " - " + stream.quality;
  title += " " + String(stream.kind || "stream").toUpperCase();
  return {
    name: name,
    title: title,
    url: stream.url,
    quality: stream.quality,
    size: stream.size || "",
    headers: stream.headers || {},
  };
}
