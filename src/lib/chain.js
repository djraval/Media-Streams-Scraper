// Generic "post → outbound links → hop pages → player backends" engine.
//
// Most Indian-serial source sites are thin shells: an episode post contains
// outbound links (hrefs, onclick args, iframe srcs, bare player URLs in the
// markup) that either ARE a known backend (vkspeed/vkprime embed, flow.tvlogy,
// yandex HLS, dstshndisk media_meta) or lead to a hop page containing one.
// Instead of per-site element names, this engine harvests every absolute URL
// from the markup and classifies each by its shape.
//
// Provider configs declare only what's genuinely per-site:
//   - how to find episode posts (searchUrls / listingUrls / postUrls + hostRe)
//   - transforms: URL rewrites that skip ad gates entirely
//     (e.g. tellyduniya/usn/{gate}.php?docid → articleweb/vid/{path}.php?id=,
//      getlink.php?v&part2&part3 → media_meta.php?v= per token)
//   - optional extra hop patterns and per-hop stream labels
//
// Referer rule baked in: a backend URL is always resolved with the URL of the
// page it was found on — flow.tvlogy.to 403s on any other referer.

import { BROWSER_HEADERS } from "./constants.js";
import { resolveFetch, fetchFirstResult, fetchContentLength, fetchJson } from "./http.js";
import { dedupe, dedupeStreams, isPlaceholderUrl, links, resolveRelativeUrl, decodeText } from "./html.js";
import { buildMediaRequest, episodeDateSlug } from "./tmdb.js";
import { episodePostCandidates } from "./episodes.js";
import { resolveVkPlayer } from "./vkplayer.js";
import { resolveFlowPlayer } from "./flow.js";
import { resolveUpbolt, UPBOLT_RE } from "./upbolt.js";
import { TMDB_API_KEY } from "./constants.js";
import { toNuvioStream, formatBytes } from "./format.js";

// ---------------------------------------------------------------------------
// Backend recognition — dispatched purely on URL shape
// ---------------------------------------------------------------------------

var VK_EMBED_RE = /(vkspeed|vkprime)\.com\/embed-[A-Za-z0-9_-]+(?:-\d+x\d+)?\.html/i;
var FLOW_RE = /flow\.tvlogy\.to\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?/i;
var MEDIA_META_RE = /\/media_meta\.php\?v=/i;
var M3U8_RE = /\.m3u8(?:\?|$)/i;
var MP4_RE = /\.mp4(?:\?|$)/i;

// "Player-ish page" heuristic: a .php script carrying query params (the real
// player URLs on these sites are always .php?id=/.php?v=/.php?docid= style).
// Host-agnostic on purpose — hop hosts rotate constantly (business-credits.cc
// yesterday, something else tomorrow); the .php+query shape is the stable part.
var HOP_PATH_RE = /\.php\?[^"'\s]*(?:id|v|url|docid|slug|source|src|file|embed|video|watch|play|go)=/i;

// Hosts/paths that never lead to a player — nav, social, ads, assets.
var JUNK_RE =
  /(?:facebook|twitter|instagram|t\.me|telegram|whatsapp|pinterest|youtube|google|gstatic|doubleclick|googlesyndication|popads|histats|feedburner|gravatar|disqus|w3\.org|schema\.org|gmpg\.org|creativecommons)\.|wp-(?:content|includes|json)|xmlrpc|\/feed\/|sitemap|\.css|\.js(?:on)?(?:\?|$)|\.(?:png|jpe?g|gif|svg|ico|woff2?|webp)(?:\?|$)|wp-login|#respond|\/comments?\//i;

// ---------------------------------------------------------------------------
// URL harvest — every absolute URL on the page, in document order, plus the
// nearest anchor label when one exists (used as sourceTag hints).
// ---------------------------------------------------------------------------

function stripTags(raw) {
  return String(raw || "").replace(/<[^>]*>/g, "").trim();
}

function harvestPage(markup, pageUrl) {
  var found = [];
  var push = function (url, label) {
    if (!url) return;
    url = decodeText(String(url).trim());
    if (url.indexOf("//") === 0) url = "https:" + url;
    if (url.charAt(0) === "/" || url.indexOf("http") !== 0) {
      url = resolveRelativeUrl(pageUrl, url);
    }
    if (url.indexOf("http") === 0) found.push({ url: url, label: label || "" });
  };

  // 1) Anchor blocks — grab every URL inside the tag (href or onclick-arg)
  //    and keep the inner text as the label.
  var aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = aRe.exec(markup)) !== null) {
    var inner = stripTags(m[2]);
    // Server names usually sit in parens ("Watch Online (GOF)") — prefer the
    // paren content over the whole ad-flavored anchor text.
    var pm = inner.match(/\(([^()]{1,40})\)/);
    var label = pm ? pm[1] : inner.slice(0, 60);
    var urls = m[1].match(/https?:\/\/[^"'\s)]+|\/\/[^"'\s)]+/g) || [];
    urls.forEach(function (u) { push(u.replace(/[,;]+$/, ""), label); });
  }

  // 2) Attribute values anywhere (iframe SRC= any case, data-*, src, source).
  var attrRe = /(?:src|href|file|source|data-[A-Za-z_-]+|streamUrl)\s*=\s*["']([^"'<>\s]+)["']/gi;
  while ((m = attrRe.exec(markup)) !== null) {
    push(m[1], "");
  }

  // 3) Bare known-backend URLs inside scripts/text (vkspeed embeds quoted in
  //    body text, m3u8/mp4 literals inside player JS).
  var bareRe = /(https?:\/\/[^"'\s<>)\]]+(?:vkspeed\.com|vkprime\.com|flow\.tvlogy\.to|streaming\.disk\.yandex\.net|media_meta\.php|\.m3u8|\.mp4)[^"'\s<>)\]]*)/gi;
  while ((m = bareRe.exec(markup)) !== null) {
    push(m[1], "");
  }

  // dedupe by url, keep first label
  var seen = {};
  return found.filter(function (e) {
    if (seen[e.url]) return false;
    seen[e.url] = true;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Backend resolution
// ---------------------------------------------------------------------------

function cleanPartTitle(title) {
  return String(title || "")
    .replace(/\s*\d{1,2}(?:st|nd|rd|th)\s+\w+\s+\d{4}\s*$/i, "")
    .trim();
}

function resolveBackend(url, referer, fetchImpl, ctx) {
  // dstshndisk media_meta → signed MP4
  if (MEDIA_META_RE.test(url)) {
    var metaBase = url.slice(0, url.lastIndexOf("/") + 1);
    return fetchJson(fetchImpl, url).then(function (meta) {
      if (!meta || !meta.source || !meta.source.file) return null;
      var abs = function (u) {
        return u && u.indexOf("http") !== 0 ? metaBase + u : u;
      };
      return {
        backend: "dstshndisk",
        kind: "mp4",
        quality: "480p",
        url: abs(meta.source.file),
        fallbackUrl: abs(meta.source.fallbackFile),
        size: "",
        sizeBytes: 0,
        sourceTag: cleanPartTitle(meta.source.title),
        headers: null,
      };
    });
  }

  // VkSpeed / VkPrime embed → MP4 + size probe
  var vkM = url.match(VK_EMBED_RE);
  if (vkM) {
    var embedUrl = "https://" + vkM[0].replace(/^https?:\/\//i, "");
    return resolveVkPlayer(embedUrl, referer, { fetchImpl: fetchImpl }).then(function (sources) {
      var real = (sources || []).filter(function (s) {
        return !isPlaceholderUrl(s.url);
      });
      if (real.length === 0) return null;
      var best = real[0];
      var stream = {
        backend: embedUrl.toLowerCase().indexOf("vkspeed") !== -1 ? "vkspeed" : "vkprime",
        kind: "mp4",
        quality: best.quality || "unknown",
        url: best.url,
        size: "",
        sizeBytes: 0,
        sourceTag: ctx.label || "",
        headers: best.headers,
      };
      return fetchContentLength(fetchImpl, best.url, best.headers).then(function (sizeBytes) {
        stream.size = formatBytes(sizeBytes);
        stream.sizeBytes = sizeBytes;
        return stream;
      });
    });
  }

  // Flow.tvlogy HLS (needs referer = page that embeds it)
  var fM = url.match(FLOW_RE);
  if (fM) {
    var flowUrl = fM[0].indexOf("http") === 0 ? fM[0] : "https://" + fM[0];
    return resolveFlowPlayer(flowUrl, referer, { fetchImpl: fetchImpl }).then(function (stream) {
      if (stream && ctx.label && !stream.sourceTag) stream.sourceTag = ctx.label;
      return stream;
    });
  }

  // UpBolt embed — CF-gated for browsers but crawler UAs get the player page
  if (UPBOLT_RE.test(url)) {
    return resolveUpbolt(url.indexOf("http") === 0 ? url : "https://" + url, {
      fetchImpl: fetchImpl,
    }).then(function (stream) {
      if (stream && ctx.label && !stream.sourceTag) stream.sourceTag = ctx.label;
      return stream;
    });
  }

  // Direct HLS (yandex disk, anything .m3u8)
  if (M3U8_RE.test(url)) {
    return Promise.resolve({
      backend: url.indexOf("yandex") !== -1 ? "yandex" : "hls",
      kind: "hls",
      quality: "",
      url: url,
      size: "",
      sizeBytes: 0,
      sourceTag: ctx.label || "",
      headers: null,
    });
  }

  // Direct MP4
  if (MP4_RE.test(url)) {
    return Promise.resolve({
      backend: "mp4",
      kind: "mp4",
      quality: "",
      url: url,
      size: "",
      sizeBytes: 0,
      sourceTag: ctx.label || "",
      headers: null,
    });
  }

  return Promise.resolve(null);
}

// Canonical dedupe key — identical backend content reached via different
// skins/hops resolves to one entry (e.g. 4 tvcine player.php ids sharing one
// flowId, or the same vkcdn file from two posts).
function candidateKey(url) {
  var m;
  if ((m = url.match(/flow\.tvlogy\.to\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/i))) {
    return "flow:" + m[1];
  }
  if ((m = url.match(/(vkspeed|vkprime)\.com\/embed-([A-Za-z0-9_-]+)/i))) {
    return m[1].toLowerCase() + ":" + m[2];
  }
  if ((m = url.match(/media_meta\.php\?v=([^&]+)/i))) {
    return "meta:" + m[1];
  }
  if ((m = url.match(/upbolt\.to\/(?:emb-|e\/)([A-Za-z0-9_-]+)/i))) {
    return "upbolt:" + m[1];
  }
  return url;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

// One page → candidate URLs → transforms → {backends, hops}
function partitionUrls(markup, pageUrl, cfg) {
  var harvested = harvestPage(markup, pageUrl);
  var backends = [];
  var hops = [];
  var hopSeen = {};
  var backendSeen = {};

  harvested.forEach(function (entry) {
    var urls = [entry];
    // Site-specific rewrites consume the URL and emit replacements.
    (cfg.transforms || []).forEach(function (t) {
      var next = [];
      urls.forEach(function (u) {
        var mm = u.url.match(t.match);
        if (mm) {
          var out = t.expand(mm, u.url) || [];
          out.forEach(function (nu) {
            next.push({ url: nu, label: u.label });
          });
        } else {
          next.push(u);
        }
      });
      urls = next;
    });

    urls.forEach(function (u) {
      var url = u.url;
      var key = candidateKey(url);
      if (
        MEDIA_META_RE.test(url) || VK_EMBED_RE.test(url) || FLOW_RE.test(url) ||
        M3U8_RE.test(url) || MP4_RE.test(url) || UPBOLT_RE.test(url)
      ) {
        if (!backendSeen[key]) {
          backendSeen[key] = true;
          backends.push({ url: url, label: u.label });
        }
        return;
      }
      var isHop =
        (HOP_PATH_RE.test(url) || (cfg.extraHopRe || []).some(function (re) { return re.test(url); })) &&
        !JUNK_RE.test(url) &&
        !(cfg.skipHopRe && cfg.skipHopRe.test(url));
      if (isHop && !hopSeen[url]) {
        hopSeen[url] = true;
        hops.push({ url: url, label: u.label });
      }
    });
  });
  return { backends: backends, hops: hops };
}

// Resolve a post URL: fetch → harvest → dispatch backends + follow hops
// (depth 1) → harvest hops → dispatch their backends.
export function resolvePost(fetchImpl, postUrl, cfg) {
  var maxHops = cfg.maxHops || 8;
  return fetchImpl(postUrl, { headers: BROWSER_HEADERS })
    .then(function (res) { return res ? res.text() : null; })
    .then(function (post) {
      if (!post) return [];
      var found = partitionUrls(post, postUrl, cfg);

      var backendJobs = found.backends.map(function (b) {
        return resolveBackend(b.url, postUrl, fetchImpl, { label: b.label })
          .catch(function () { return null; });
      });

      var hopJobs = found.hops.slice(0, maxHops).map(function (hop) {
        return fetchImpl(hop.url, {
          headers: { Referer: postUrl, "User-Agent": BROWSER_HEADERS["User-Agent"] },
        })
          .then(function (res) { return res ? res.text() : null; })
          .then(function (hopPage) {
            if (!hopPage) return [];
            var inner = partitionUrls(hopPage, hop.url, cfg);
            // Hop pages get a label from the hop URL itself when the provider
            // wants one (desitvbox's jwplayer/mobiplayer/player skin names).
            var hopTag = cfg.hopTag ? cfg.hopTag(hop.url) : (hop.label || "");
            return Promise.all(
              inner.backends.map(function (b) {
                return resolveBackend(b.url, hop.url, fetchImpl, {
                  label: b.label || hopTag,
                }).catch(function () { return null; });
              }),
            );
          })
          .catch(function () { return []; });
      });

      return Promise.all([Promise.all(backendJobs), Promise.all(hopJobs)]).then(function (groups) {
        var streams = [];
        groups[0].forEach(function (s) { if (s) streams.push(s); });
        groups[1].forEach(function (set) {
          (set || []).forEach(function (s) { if (s) streams.push(s); });
        });
        return dedupeStreams(streams);
      });
    })
    .catch(function () { return []; });
}

// ---------------------------------------------------------------------------
// Provider factory — everything except per-site config is shared
// ---------------------------------------------------------------------------

export function displayBackend(backend) {
  return String(backend || "source")
    .replace(/(^|[-_\s]+)([a-z])/g, function (_m, prefix, ch) { return prefix + ch.toUpperCase(); })
    .replace(/[-_]+/g, "");
}

function wpSearchUrls(request, siteBase, searchPath, slugCandidates, datedFirst) {
  var dateSlug = episodeDateSlug(request.airDate);
  var terms = function (s) {
    return encodeURIComponent(s.replace(/-/g, " ")).replace(/%20/g, "+");
  };
  var urls = [];
  var slugs = slugCandidates.slice(0, 3);
  if (dateSlug) {
    var dq = dateSlug.replace(/-/g, " ");
    slugs.forEach(function (s) {
      urls.push(siteBase + searchPath + encodeURIComponent(s.replace(/-/g, " ") + " " + dq).replace(/%20/g, "+"));
    });
  }
  slugs.forEach(function (s) {
    urls.push(siteBase + searchPath + terms(s));
  });
  return dedupe(urls);
}

export function chainProvider(cfg) {
  var logTag = "[" + cfg.name + "]";

  function slugVariants(request) {
    var candidates = request.slugCandidates || [];
    if (!cfg.stripTrailingS) return candidates;
    return dedupe(
      candidates
        .map(function (slug) { return slug.replace(/-s(?=-|$)/g, "s"); })
        .concat(candidates),
    );
  }

  function searchUrls(request) {
    if (cfg.searchUrls) return cfg.searchUrls(request, slugVariants(request));
    return wpSearchUrls(request, cfg.siteBase, cfg.searchPath || "/?s=", slugVariants(request));
  }

  function postCandidates(markup, request) {
    if (cfg.postCandidates) return cfg.postCandidates(markup, request);
    return episodePostCandidates(links(markup), request, cfg.hostRe, cfg.nonPostRe);
  }

  // Direct candidate URLs (built from slug+date patterns) tried before search.
  function directUrls(request) {
    return cfg.postUrls ? cfg.postUrls(request, slugVariants(request)) : [];
  }

  function listingUrls(request) {
    return cfg.listingUrls ? cfg.listingUrls(request, slugVariants(request)) : [];
  }

  function postsFromPages(fetchImpl, urls, request) {
    if (urls.length === 0) return Promise.resolve(null);
    return fetchFirstResult(fetchImpl, urls, { headers: BROWSER_HEADERS }, function (page) {
      var cands = postCandidates(page, request);
      return cands.length > 0 ? cands : null;
    });
  }

  function resolveRequest(request, options) {
    options = options || {};
    var fetchImpl = resolveFetch(options);
    var maxPosts = cfg.maxPosts || 2;

    function resolvePosts(urls) {
      if (!urls || urls.length === 0) return Promise.resolve([]);
      return Promise.all(
        urls.slice(0, maxPosts).map(function (url) {
          return resolvePost(fetchImpl, url, cfg);
        }),
      ).then(function (sets) {
        var all = [];
        sets.forEach(function (set) {
          (set || []).forEach(function (s) { if (s) all.push(s); });
        });
        return dedupeStreams(all);
      });
    }

    function fromDiscovery() {
      return postsFromPages(fetchImpl, searchUrls(request), request).then(function (posts) {
        if (posts && posts.length > 0) return resolvePosts(posts);
        return postsFromPages(fetchImpl, listingUrls(request), request).then(resolvePosts);
      });
    }

    // Direct candidate URLs are themselves post pages — resolve each until
    // one yields streams, else fall back to search/listing discovery.
    var direct = directUrls(request);
    if (direct.length > 0) {
      var idx = 0;
      var tryDirect = function () {
        if (idx >= direct.length) return Promise.resolve([]);
        var url = direct[idx];
        idx += 1;
        return resolvePost(fetchImpl, url, cfg).then(function (streams) {
          return streams.length > 0 ? streams : tryDirect();
        });
      };
      return tryDirect().then(function (streams) {
        return streams.length > 0 ? streams : fromDiscovery();
      });
    }
    return fromDiscovery();
  }

  function getStreamsForRequest(request, options) {
    return resolveRequest(request, options)
      .then(function (resolved) {
        return dedupeStreams(resolved).map(function (stream) {
          if (cfg.streamName) {
            stream.name = cfg.streamName(stream);
          } else {
            stream.name =
              cfg.name + " " + displayBackend(stream.backend) +
              (stream.sourceTag ? " (" + stream.sourceTag + ")" : "");
          }
          return toNuvioStream(request, stream);
        });
      })
      .catch(function (error) {
        console.log(logTag + " resolver failed: " + error.message);
        return [];
      });
  }

  function getStreams(tmdbId, mediaType, season, episode) {
    if (cfg.mediaTypes && cfg.mediaTypes.indexOf(mediaType) === -1) {
      return Promise.resolve([]);
    }
    return buildMediaRequest(tmdbId, mediaType, season, episode, { tmdbApiKey: TMDB_API_KEY })
      .then(function (request) {
        return getStreamsForRequest(request, { fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
      })
      .catch(function (error) {
        console.log(logTag + " getStreams failed: " + error.message);
        return [];
      });
  }

  return { getStreams: getStreams, getStreamsForRequest: getStreamsForRequest };
}
