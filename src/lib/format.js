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
