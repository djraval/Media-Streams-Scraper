// TMDB API helpers + title/slug normalization.

import { TMDB_BASE, TMDB_API_KEY, MONTHS, CHANNEL_SLUGS } from "./constants.js";
import { dedupe } from "./html.js";
import { resolveFetch, fetchJson } from "./http.js";

export { TMDB_BASE, TMDB_API_KEY, MONTHS, CHANNEL_SLUGS, resolveFetch, fetchJson };

export function tmdbUrl(path, tmdbApiKey) {
  var separator = path.indexOf("?") !== -1 ? "&" : "?";
  return TMDB_BASE + path + separator + "api_key=" + encodeURIComponent(tmdbApiKey);
}

export function normalizeTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugCandidates(title) {
  var base = normalizeTitle(title);
  if (!base) return [];
  var candidates = [base];
  if (base.indexOf("aa") !== -1) {
    candidates.push(base.replace(/aa/g, "a"));
  }
  // Handle hyphenated abbreviations: "yeh-rishta-kya-kehlata-hai" → "yrkkh"
  if (base.indexOf("-") !== -1) {
    var parts = base.split("-").filter(function (p) { return p.length > 0; });
    if (parts.length > 1) {
      var abbr = parts.map(function (p) { return p.charAt(0); }).join("");
      candidates.push(abbr);
      candidates.push(parts.join(""));
    }
  }
  return dedupe(candidates);
}

export function requestSlugCandidates(title, season) {
  var candidates = slugCandidates(title);
  if (season > 1 && candidates.length > 0) {
    candidates.push(candidates[0] + "-" + season);
  }
  return dedupe(candidates);
}

export function channelSlugCandidates(networks) {
  var candidates = [];
  for (var i = 0; i < (networks || []).length; i++) {
    var key = String(networks[i] || "").trim().toLowerCase();
    if (CHANNEL_SLUGS[key]) {
      for (var j = 0; j < CHANNEL_SLUGS[key].length; j++) {
        candidates.push(CHANNEL_SLUGS[key][j]);
      }
    }
  }
  return dedupe(candidates);
}

export function episodeDateSlug(isoDate) {
  var match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  var day = Number(match[3]);
  var suffix = day % 100 >= 10 && day % 100 <= 20
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  var month = MONTHS[Number(match[2]) - 1];
  return day + suffix + "-" + month + "-" + match[1];
}

// Build a media request object from TMDB. Supports both TV and movie.
export function buildMediaRequest(tmdbId, mediaType, season, episode, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var tmdbApiKey = options.tmdbApiKey || TMDB_API_KEY;
  if (!tmdbApiKey) {
    return Promise.reject(new Error("TMDB API key is required"));
  }

  if (mediaType === "tv") {
    var tvInfo = null;
    return fetchJson(fetchImpl, tmdbUrl("/tv/" + tmdbId, tmdbApiKey))
      .then(function (tv) {
        tvInfo = tv;
        return fetchJson(
          fetchImpl,
          tmdbUrl("/tv/" + tmdbId + "/season/" + season + "/episode/" + episode, tmdbApiKey),
        );
      })
      .then(function (ep) {
        var title = tvInfo.name || tvInfo.original_name || "";
        var networkCandidates = channelSlugCandidates(
          (tvInfo.networks || []).map(function (network) { return network.name; }),
        );
        return {
          title: title,
          mediaType: mediaType,
          season: season,
          episode: episode,
          airDate: ep.air_date || "",
          episodeTitle: ep.name || "",
          networkCandidates: networkCandidates,
          runtimeMinutes: Number(ep.runtime || (tvInfo.episode_run_time && tvInfo.episode_run_time[0]) || 0) || null,
          slugCandidates: requestSlugCandidates(title, season),
          fallbackChannelSlugs: dedupe(Object.values(CHANNEL_SLUGS).flat()),
        };
      });
  }

  if (mediaType === "movie") {
    return fetchJson(fetchImpl, tmdbUrl("/movie/" + tmdbId, tmdbApiKey))
      .then(function (movie) {
        var title = movie.title || movie.original_title || "";
        var releaseDate = movie.release_date || "";
        var airYear = releaseDate ? releaseDate.substring(0, 4) : "";
        return {
          title: title,
          mediaType: mediaType,
          season: null,
          episode: null,
          airDate: releaseDate,
          airYear: airYear,
          runtimeMinutes: Number(movie.runtime || 0) || null,
          slugCandidates: slugCandidates(title),
        };
      });
  }

  return Promise.reject(new Error("Unsupported media type: " + mediaType));
}
