// Shared constants across all providers.

export const TMDB_BASE = "https://api.themoviedb.org/3";
export const TMDB_API_KEY = "4e1899804b6db6d01db1e59391e8a5fe";

export const UA = (
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
);
export const BROWSER_HEADERS = { "User-Agent": UA };

export const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export const CHANNEL_SLUGS = {
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
  "starplus": ["star-plus"],
  "zee tv": ["zee-tv"],
};

export const VKSPEED_HOSTS = ["vkspeed.com", "vkcdn5.com", "vkcdn6.com", "vkcdn7.com"];
export const VKPRIME_HOSTS = ["vkprime.com"];
