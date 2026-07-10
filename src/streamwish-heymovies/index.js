// StreamWish HeyMovies Nuvio provider — resolves Indian movies and TV shows
// from heymovies.cyou via StreamWish (HLS) player.
// StreamWish embed pages use javascript-obfuscator + Dean Edwards P.A.C.K.E.R.;
// no crypto needed — just unpack and regex-extract m3u8 URLs.
// heymovies.cyou uses a /stream?v={post_id} endpoint with <li class="linkserver" data-video="{url}">.

import { BROWSER_HEADERS, UA } from "../lib/constants.js";
import { resolveFetch, fetchText, fetchFirstResult } from "../lib/http.js";
import { dedupe, dedupeStreams } from "../lib/html.js";
import { buildMediaRequest, slugCandidates } from "../lib/tmdb.js";
import { resolveStreamWish, isStreamWishUrl } from "../lib/streamwish.js";
import { toNuvioStream } from "../lib/format.js";

// heymovies.live 301-redirects to heymovies.cyou (canonical domain).
var SITE_BASE = "https://heymovies.cyou";

// ---------------------------------------------------------------------------
// Search + page discovery
// ---------------------------------------------------------------------------

// Build search URLs for heymovies.cyou (WordPress search).
function buildSearchUrls(request) {
  var queries = [];
  var title = request.title || "";

  // Primary: full title
  queries.push(title.toLowerCase().trim());

  // Title + year (helps narrow results)
  if (request.airYear) {
    queries.push(title + " " + request.airYear);
  }

  // Slug variants (without hyphens, with spaces)
  var slugs = slugCandidates(title);
  for (var i = 0; i < slugs.length; i++) {
    queries.push(slugs[i].replace(/-/g, " "));
  }

  queries = dedupe(queries);
  var urls = [];
  for (var j = 0; j < queries.length; j++) {
    urls.push(SITE_BASE + "/?s=" + encodeURIComponent(queries[j]));
  }
  return urls;
}

// Extract movie/show page URLs from search results HTML.
// Results are in <article class="post-item"> cards with <a href="..."> links.
function extractPageUrls(html) {
  var str = String(html || "");
  var results = [];

  // Pattern: <a href="..." ... rel="bookmark"> — these are movie/show page links in cards
  var linkRegex = /<a[^>]*href="(https?:\/\/(?:www\.)?heymovies\.(?:cyou|live)\/[^"?#]+\/)"[^>]*rel="bookmark"/gi;
  var matches = str.match(linkRegex) || [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i].match(/href="([^"]+)"/);
    if (m) results.push(m[1]);
  }

  // Fallback: entry-header links
  if (results.length === 0) {
    var entryRegex = /<a[^>]*class="[^"]*entry-header[^"]*"[^>]*href="(https?:\/\/(?:www\.)?heymovies\.(?:cyou|live)\/[^"?#]+\/)"/gi;
    var entryMatches = str.match(entryRegex) || [];
    for (var e = 0; e < entryMatches.length; e++) {
      var em = entryMatches[e].match(/href="([^"]+)"/);
      if (em) results.push(em[1]);
    }
  }

  // Dedupe, filter out non-content URLs
  var filtered = [];
  var seen = {};
  for (var j = 0; j < results.length; j++) {
    var url = results[j].replace("heymovies.live", "heymovies.cyou");
    // Skip category, quality, tag, page, author, genre, wp- URLs
    if (/\/(category|quality|tag|page|author|genre|wp-)\//.test(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    filtered.push(url);
  }

  return filtered;
}

// Extract title and year from search result card.
function extractCardInfo(html, cardIndex) {
  var str = String(html || "");
  // <h2 class="entry-title">Title</h2>
  var titleMatch = str.match(/<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)<\/h2>/i);
  // <p class="cataz-card-meta">2024 <span...>Movie</span></p>
  var metaMatch = str.match(/<p[^>]*class="[^"]*cataz-card-meta[^"]*"[^>]*>\s*(\d{4})/i);
  // <span class="cataz-type-chip">Movie</span> or TV
  var typeMatch = str.match(/<span[^>]*class="[^"]*cataz-type-chip[^"]*"[^>]*>([^<]+)<\/span>/i);
  // <span class="cataz-quality">HD 720</span>
  var qualityMatch = str.match(/<span[^>]*class="[^"]*cataz-quality[^"]*"[^>]*>([^<]+)<\/span>/i);

  return {
    title: titleMatch ? titleMatch[1].trim() : "",
    year: metaMatch ? metaMatch[1] : "",
    type: typeMatch ? typeMatch[1].trim().toLowerCase() : "",
    quality: qualityMatch ? qualityMatch[1].trim() : "",
  };
}

// Check if a card matches the request (title + year + type).
function cardMatches(html, request) {
  var info = extractCardInfo(html);
  if (!info.title) return false;

  var cardTitle = info.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  var reqTitle = (request.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cardTitle || !reqTitle) return false;

  // Title match (partial ok — card may have "Dubbed" suffix)
  if (cardTitle.indexOf(reqTitle) === -1 && reqTitle.indexOf(cardTitle) === -1) {
    return false;
  }

  // Year match (if both have years)
  if (info.year && request.airYear && info.year !== request.airYear) {
    return false;
  }

  return true;
}

// Extract the stream endpoint URL from a movie/show page.
// Pattern: <span class="episode-button play-button" data-link="https://heymovies.cyou/stream?v={id}">
function extractStreamEndpoint(html) {
  var str = String(html || "");
  var match = str.match(/data-link="(https?:\/\/[^"]*heymovies\.(?:cyou|live)\/stream\?v=\d+)"/i);
  if (match) return match[1].replace("heymovies.live", "heymovies.cyou");
  return null;
}

// Extract all episode stream endpoints from a TV show page.
// For multi-episode shows, each episode button has its own data-link.
function extractEpisodeStreamEndpoints(html) {
  var str = String(html || "");
  var regex = /data-link="(https?:\/\/[^"]*heymovies\.(?:cyou|live)\/stream\?v=\d+)"/gi;
  var matches = str.match(regex) || [];
  var urls = [];
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i].match(/data-link="([^"]+)"/);
    if (m) {
      var url = m[1].replace("heymovies.live", "heymovies.cyou");
      if (urls.indexOf(url) === -1) urls.push(url);
    }
  }
  return urls;
}

// Extract StreamWish embed URLs from the stream endpoint HTML.
// Pattern: <li class="linkserver" data-video="{url}">{label}</li>
// IMPORTANT: Check URL domain, not label text (labels are unreliable on this site).
function extractStreamWishEmbeds(html) {
  var str = String(html || "");
  var results = [];

  // Pattern: <li class="linkserver" data-video="{url}">
  var regex = /<li[^>]*class="[^"]*linkserver[^"]*"[^>]*data-video="([^"]+)"[^>]*>([^<]*)<\/li>/gi;
  var match;
  while ((match = regex.exec(str)) !== null) {
    var url = match[1];
    var label = match[2].trim();
    if (isStreamWishUrl(url)) {
      results.push({ url: url, quality: "", label: label });
    }
  }

  // Also check for data-video on other elements (some pages use different markup)
  if (results.length === 0) {
    var simpleRegex = /data-video="(https?:\/\/[^"]*(?:streamwish|strwish|wishembed|awish|embedwish|swhoi|hgcloud|hglink|mwish|dwish)[^"]*\/e\/[^"]+)"/gi;
    var simpleMatch;
    while ((simpleMatch = simpleRegex.exec(str)) !== null) {
      results.push({ url: simpleMatch[1], quality: "", label: "" });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Stream resolution pipeline
// ---------------------------------------------------------------------------

// Resolve StreamWish streams from a stream endpoint URL.
function resolveFromStreamEndpoint(fetchImpl, streamUrl, request) {
  return fetchText(fetchImpl, streamUrl, { headers: BROWSER_HEADERS }).then(function (html) {
    if (!html) return [];
    var embeds = extractStreamWishEmbeds(html);
    if (embeds.length === 0) return [];

    return Promise.all(
      embeds.map(function (embed) {
        return resolveStreamWish(fetchImpl, embed.url, streamUrl).then(function (streams) {
          return streams.map(function (s) {
            s.sourceTag = "StreamWish";
            return s;
          });
        }).catch(function () { return []; });
      })
    ).then(function (allStreams) {
      var flat = [];
      for (var i = 0; i < allStreams.length; i++) {
        for (var j = 0; j < allStreams[i].length; j++) {
          flat.push(allStreams[i][j]);
        }
      }
      return dedupeStreams(flat);
    });
  });
}

function getStreamsForRequest(request, options) {
  options = options || {};
  var fetchImpl = resolveFetch(options);

  // Support both movies and TV
  var searchUrls = buildSearchUrls(request);

  // Step 1: Search for the title
  return fetchFirstResult(fetchImpl, searchUrls.slice(0, 4), { headers: BROWSER_HEADERS }, function (html) {
    if (!html) return null;
    // Check for no results
    if (html.indexOf("search-no-results") !== -1) return null;
    var pageUrls = extractPageUrls(html);
    return pageUrls.length > 0 ? pageUrls : null;
  }).then(function (pageUrls) {
    if (!pageUrls || pageUrls.length === 0) return [];

    // Step 2: Fetch the first matching movie/show page to get stream endpoint
    return fetchFirstResult(fetchImpl, pageUrls.slice(0, 5), { headers: BROWSER_HEADERS }, function (html) {
      if (!html) return null;

      // For TV: extract episode-specific stream endpoints
      if (request.mediaType === "tv" && request.season && request.episode) {
        var epEndpoints = extractEpisodeStreamEndpoints(html);
        // For multi-episode shows, try to match episode number
        // Episode buttons are labeled "EP 1", "EP 2", etc.
        var epRegex = /<span[^>]*class="[^"]*episode-button[^"]*"[^>]*data-link="([^"]+)"[^>]*>\s*<i[^>]*><\/i>\s*EP\s*(\d+)/gi;
        var epMatch;
        var epUrls = {};
        while ((epMatch = epRegex.exec(html)) !== null) {
          var epNum = Number(epMatch[2]);
          var epUrl = epMatch[1].replace("heymovies.live", "heymovies.cyou");
          epUrls[epNum] = epUrl;
        }
        // If we found episode-specific URLs, use the one matching request.episode
        if (epUrls[request.episode]) {
          return { type: "stream", url: epUrls[request.episode] };
        }
        // Fallback: use first stream endpoint (single-episode shows)
        var endpoint = extractStreamEndpoint(html);
        if (endpoint) return { type: "stream", url: endpoint };
        return null;
      }

      // For movies: just get the stream endpoint
      var endpoint2 = extractStreamEndpoint(html);
      if (endpoint2) return { type: "stream", url: endpoint2 };
      return null;
    }).then(function (result) {
      if (!result || result.type !== "stream") return [];

      // Step 3: Fetch the stream endpoint and resolve StreamWish embeds
      return resolveFromStreamEndpoint(fetchImpl, result.url, request);
    });
  }).then(function (resolved) {
    return resolved.map(function (stream) {
      stream.name = "HeyMovies StreamWish";
      if (stream.sourceTag) {
        stream.name += " (" + stream.sourceTag + ")";
      }
      return toNuvioStream(request, stream);
    });
  }).catch(function (error) {
    console.log("[StreamWish HeyMovies] getStreams failed: " + error.message);
    return [];
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  if (mediaType !== "movie" && mediaType !== "tv") {
    return Promise.resolve([]);
  }
  return buildMediaRequest(tmdbId, mediaType, season, episode, {})
    .then(function (request) {
      return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
    })
    .catch(function (error) {
      console.log("[StreamWish HeyMovies] getStreams failed: " + error.message);
      return [];
    });
}

// Dual export pattern for Nuvio sandbox and Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
