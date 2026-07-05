// Desi-Serials.to Nuvio provider — single-file scraper.
// Resolves Indian TV episodes from desi-serials.to via VkPrime (MP4) and Flow (HLS) players.

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe";

const UA = (
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
);
const BROWSER_HEADERS = { "User-Agent": UA };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const CHANNEL_SLUGS = {
  "& tv": ["and-tv"],
  "&tv": ["and-tv"],
  "and tv": ["and-tv"],
  "colors": ["color-tv-hd", "colors-tv"],
  "colors tv": ["color-tv-hd", "colors-tv"],
  "dangal tv": ["dangal-tv"],
  "sab tv": ["sab-tv-hd", "sab-tv"],
  "sony sab": ["sab-tv-hd", "sab-tv"],
  "sony tv": ["sony-tv"],
  "star bharat": ["star-bharat"],
  "star plus": ["star-plus"],
  "zee tv": ["zee-tv"],
};

const DESI_SERIALS_HOST_RE = /^https:\/\/www\.desi-serials\.to\//i;
const TVARTICLES_RE = /^https:\/\/tvarticles\.org\/vidd\.php\?id=\d+/i;
const VKPRIME_RE = /^https:\/\/vkprime\.com\/embed-[A-Za-z0-9-]+\.html$/i;
const FLOW_RE = /^https:\/\/flow\.tvlogy\.to\/[A-Za-z0-9/_-]+\/?$/i;

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function decodeText(raw) {
  let text = String(raw || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  const replacements = [
    [/\\\//gi, "/"],
    [/\\u0026/gi, "&"],
    [/\\u003d/gi, "="],
    [/\\u003f/gi, "?"],
    [/\\u002f/gi, "/"],
    [/\\x26/gi, "&"],
    [/\\x3d/gi, "="],
    [/\\x3f/gi, "?"],
    [/\\x2f/gi, "/"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&");
}

function englishOrd(n) {
  if (n % 100 >= 10 && n % 100 <= 20) {
    return `${n}th`;
  }
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${suffix}`;
}

function mediaCandidates(raw, extension) {
  const text = decodeText(raw);
  const pattern = new RegExp(
    "https?://[^\\s'\\\"<>\\\\,}\\]]+\\." +
      extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "(?:\\?[^\\s'\\\"<>\\\\}\\]]*)?",
    "gi",
  );
  return dedupe(
    Array.from(text.matchAll(pattern), (match) => (
      match[0].replace(/[.;)]+$/g, "")
    )),
  );
}

function mp4Candidates(raw) {
  return mediaCandidates(raw, "mp4");
}

function m3u8Candidates(raw) {
  return mediaCandidates(raw, "m3u8");
}

function attrValues(markup, tags, attrs) {
  const tagAlternation = tags.join("|");
  const attrAlternation = attrs.join("|");
  const tagPattern = new RegExp(`<\\s*(${tagAlternation})\\b[^>]*>`, "gis");
  const attrPattern = new RegExp(
    `\\b(${attrAlternation})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const values = [];
  for (const tag of String(markup || "").matchAll(tagPattern)) {
    const attr = tag[0].match(attrPattern);
    if (attr) {
      values.push(decodeText((attr[2] || attr[3] || attr[4] || "").trim()));
    }
  }
  return dedupe(values);
}

function links(markup) {
  return attrValues(markup, ["a", "link", "area"], ["href"]);
}

function iframes(markup) {
  return attrValues(markup, ["iframe"], ["src"]);
}

function packerEncode(n, base) {
  if (n === 0) {
    return "0";
  }
  let out = "";
  let value = n;
  while (value > 0) {
    const r = value % base;
    if (r < 10) {
      out = String.fromCharCode(48 + r) + out;
    } else if (r < 36) {
      out = String.fromCharCode(87 + r) + out;
    } else {
      out = String.fromCharCode(29 + r) + out;
    }
    value = Math.floor(value / base);
  }
  return out;
}

function unpack(blob) {
  const match = String(blob || "").match(
    /eval\(function\(p,a,c,k,e,(?:d|r)\).*?\}\s*\(\s*'(?<p>.*?)'\s*,\s*(?<a>\d+)\s*,\s*(?<c>\d+)\s*,\s*'(?<k>.*?)'\.split\('\|'\)/s,
  );
  if (!match || !match.groups) {
    return "";
  }

  let out = match.groups.p.replace(/\\'/g, "'");
  const base = Number(match.groups.a);
  const count = Number(match.groups.c);
  const keys = match.groups.k.replace(/\\'/g, "'").split("|");

  for (let i = count - 1; i >= 0; i -= 1) {
    if (!keys[i]) {
      continue;
    }
    const token = packerEncode(i, base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${token}\\b`, "g"), keys[i]);
  }
  return out;
}

function juicycodesPayloads(raw) {
  const payloads = [];
  const callPattern = /JuicyCodes\.Run\((?<body>.*?)\)/gs;
  const stringPattern = /(['"])(.*?)(?<!\\)\1/gs;
  for (const call of String(raw || "").matchAll(callPattern)) {
    const parts = [];
    for (const segment of call.groups.body.matchAll(stringPattern)) {
      parts.push(segment[2]);
    }
    if (parts.length > 0) {
      payloads.push(parts.join(""));
    }
  }
  return dedupe(payloads);
}

function decodeBase64(payload) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(payload || "").replace(/[^A-Za-z0-9+/=]/g, "");
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const ch of clean) {
    if (ch === "=") {
      break;
    }
    const value = alphabet.indexOf(ch);
    if (value === -1) {
      return null;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(escape(out));
  } catch (_err) {
    return out;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const digits = size >= 100 || index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[index]}`;
}

function normalizeTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugCandidates(title) {
  const base = normalizeTitle(title);
  if (!base) {
    return [];
  }
  const candidates = [base];
  if (base.includes("aa")) {
    candidates.push(base.replace(/aa/g, "a"));
  }
  return dedupe(candidates);
}

function requestSlugCandidates(title, season) {
  const candidates = slugCandidates(title);
  if (season > 1 && candidates.length > 0) {
    candidates.push(`${candidates[0]}-${season}`);
  }
  return dedupe(candidates);
}

function channelSlugCandidates(networks) {
  const candidates = [];
  for (const network of networks || []) {
    const key = String(network || "").trim().toLowerCase();
    if (CHANNEL_SLUGS[key]) {
      candidates.push(...CHANNEL_SLUGS[key]);
    }
  }
  return dedupe(candidates);
}

function episodeDateSlug(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }
  const day = Number(match[3]);
  const suffix = day % 100 >= 10 && day % 100 <= 20
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  const month = MONTHS[Number(match[2]) - 1];
  return `${day}${suffix}-${month}-${match[1]}`;
}

function fetchJson(fetchImpl, url) {
  return fetchImpl(url).then(function (response) {
    if (!response || response.ok === false) {
      const status = response ? response.status : "unknown";
      throw new Error("TMDB request failed: " + status);
    }
    return response.json();
  });
}

function tmdbUrl(path, tmdbApiKey) {
  const separator = path.includes("?") ? "&" : "?";
  return TMDB_BASE + path + separator + "api_key=" + encodeURIComponent(tmdbApiKey);
}

function buildMediaRequest(tmdbId, mediaType, season, episode, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const tmdbApiKey = options.tmdbApiKey;
  if (!tmdbApiKey) {
    return Promise.reject(new Error("TMDB API key is required"));
  }
  if (mediaType !== "tv") {
    return Promise.reject(new Error("Desi-Serials.to supports tv episodes only"));
  }
  const FALLBACK_CHANNEL_SLUGS = dedupe(Object.values(CHANNEL_SLUGS).flat());
  let tvInfo = null;
  return fetchJson(fetchImpl, tmdbUrl("/tv/" + tmdbId, tmdbApiKey))
    .then(function (tv) {
      tvInfo = tv;
      return fetchJson(
        fetchImpl,
        tmdbUrl("/tv/" + tmdbId + "/season/" + season + "/episode/" + episode, tmdbApiKey),
      );
    })
    .then(function (ep) {
      const title = tvInfo.name || tvInfo.original_name || "";
      const networkCandidates = channelSlugCandidates(
        (tvInfo.networks || []).map(function (network) { return network.name; }),
      );
      return {
        title: title,
        mediaType: mediaType,
        season: season,
        episode: episode,
        airDate: ep.air_date || "",
        episodeTitle: ep.name || "",
        firstAirDate: tvInfo.first_air_date || "",
        networkCandidates: networkCandidates,
        runtimeMinutes: Number(ep.runtime || (tvInfo.episode_run_time && tvInfo.episode_run_time[0]) || 0) || null,
        slugCandidates: requestSlugCandidates(title, season),
        fallbackChannelSlugs: FALLBACK_CHANNEL_SLUGS,
      };
    });
}

function buildCandidateUrls(request) {
  const channels = (request.networkCandidates && request.networkCandidates.length > 0)
    ? request.networkCandidates
    : request.fallbackChannelSlugs;
  const urls = [];
  for (const channel of channels) {
    for (const slug of request.slugCandidates || []) {
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/");
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/page/2/");
      urls.push("https://www.desi-serials.to/watch-online/" + channel + "/" + slug + "/page/3/");
    }
  }
  return { desiSerials: dedupe(urls) };
}
