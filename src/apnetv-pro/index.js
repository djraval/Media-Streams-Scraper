// ApneTV Nuvio provider — resolves Indian TV episodes from apnetv.pro.
// Posts embed DramaVideo via click-to-play markup:
//   <div class="server" data-sv-id="v3" data-embed="CODE">
// → player.dramavideo.se/in?id={embed}&sv={svId} → AES-CBC decrypt → HLS
// (lib/dramavideo.js handles the full player resolution.)
//
// Post slugs: {show}-{day}{st|nd|rd|th}-{month}-{year}-today-full-episode-{N}-online

import { TMDB_API_KEY, BROWSER_HEADERS } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchFirstResult } from "../lib/http.js";
import { dedupe, dedupeStreams, links } from "../lib/html.js";
import { buildMediaRequest, episodeDateSlug } from "../lib/tmdb.js";
import { episodePostCandidates } from "../lib/episodes.js";
import { toNuvioStream, sortStreamsBest } from "../lib/format.js";
import {
  dramavideoParamsFromMarkup,
  resolveDramavideoEmbed,
} from "../lib/dramavideo.js";

// ---------------------------------------------------------------------------
// Layer 0: Site configuration
// ---------------------------------------------------------------------------

var SITE_BASE = "https://apnetv.pro";
var SEARCH_PATH = "/?s=";

var SITE_HOST_RE = /^https:\/\/(?:www\.)?apnetv\.pro\//i;
var NON_POST_RE = /\/(category|tag|author|page|wp-|feed)\b|\/(about-us|contact-us|dmca|privacy-policy)\//i;

// ---------------------------------------------------------------------------
// Layer 2: Site search + episode page discovery
// ---------------------------------------------------------------------------

function buildSearchUrls(request) {
  var dateSlug = episodeDateSlug(request.airDate);
  var slugs = (request.slugCandidates || []).slice(0, 2);
  var urls = [];
  for (var i = 0; i < slugs.length; i++) {
    if (dateSlug) {
      urls.push(
        SITE_BASE + SEARCH_PATH +
          encodeURIComponent(slugs[i] + " " + dateSlug.replace(/-/g, " ")).replace(/%20/g, "+"),
      );
    }
    urls.push(
      SITE_BASE + SEARCH_PATH +
        encodeURIComponent(slugs[i].replace(/-/g, " ")).replace(/%20/g, "+"),
    );
  }
  return dedupe(urls);
}

function episodePageCandidates(markup, request) {
  return episodePostCandidates(links(markup), request, SITE_HOST_RE, NON_POST_RE);
}

// ---------------------------------------------------------------------------
// Layer 3 + 4: post → dramavideo embed params → HLS
// ---------------------------------------------------------------------------

function resolveEpisodeUrl(fetchImpl, postUrl) {
  return fetchText(fetchImpl, postUrl, { headers: BROWSER_HEADERS })
    .then(function (post) {
      if (!post) return [];
      var params = dramavideoParamsFromMarkup(post);
      if (params.length === 0) return [];
      return Promise.all(
        params.slice(0, 3).map(function (p) {
          return resolveDramavideoEmbed(fetchImpl, p.id, p.sv, postUrl);
        }),
      ).then(function (sets) {
        var streams = [];
        sets.forEach(function (set) {
          (set || []).forEach(function (s) { if (s) streams.push(s); });
        });
        return streams;
      });
    })
    .catch(function (e) {
      console.log("[ApneTV] resolve failed for " + postUrl + ": " + (e && e.message));
      return [];
    });
}

function resolveApneTV(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);
  var searchUrls = buildSearchUrls(request);
  if (searchUrls.length === 0) {
    return Promise.resolve([]);
  }
  return fetchFirstResult(fetchImpl, searchUrls, { headers: BROWSER_HEADERS }, function (page) {
    var episodeUrls = episodePageCandidates(page, request);
    return episodeUrls.length > 0 ? episodeUrls : null;
  }).then(function (episodeUrls) {
    if (!episodeUrls) return [];
    return Promise.all(
      episodeUrls.map(function (url) { return resolveEpisodeUrl(fetchImpl, url); }),
    ).then(function (sets) {
      var all = [];
      sets.forEach(function (set) {
        (set || []).forEach(function (s) { if (s) all.push(s); });
      });
      return dedupeStreams(all);
    });
  });
}

// ---------------------------------------------------------------------------
// Layer 5 + 6: Stream formatting + entry point
// ---------------------------------------------------------------------------

function getStreamsForRequest(request, options) {
  return resolveApneTV(request, options)
    .then(function (resolved) {
      return sortStreamsBest(dedupeStreams(resolved), request.runtimeMinutes).map(function (stream) {
        stream.name = "ApneTV " + stream.backend;
        return toNuvioStream(request, stream);
      });
    })
    .catch(function (error) {
      console.log("[ApneTV] resolver failed: " + error.message);
      return [];
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "tv") return Promise.resolve([]);
  return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[ApneTV] getStreams failed: " + error.message);
      return [];
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
