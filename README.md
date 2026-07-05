# desi-serials-nuvio-provider

A Nuvio client-side scraper that resolves Indian TV serial episodes from
`desi-serials.to`. It walks the show's archive page on `desi-serials.to`,
finds the episode page matching the TMDB air date, follows the
`tvarticles.org` link, and resolves one of two single-stream player
families:

- **VkPrime** — direct MP4 streams (via Dean-Edwards packer unpack)
- **Flow.tvlogy** — HLS `.m3u8` streams with playback headers

TMDB is used for title + episode air-date lookup only. The TMDB API key
is hardcoded in the scraper file (matching the convention used by other
client-side Nuvio scrapers such as phisher98/MoviesDrive and
D3adlyRocket/4khdhub).

## Install

1. Open **Nuvio** → **Settings** → **Local Scrapers**
2. Add this repository's `manifest.json` URL
3. Enable **Desi-Serials.to**

## Supported content

- **TV only.** Movies return no streams.
- Episode matching uses the TMDB air date + show slug against the
  `desi-serials.to` archive. If an episode is missing from
  `desi-serials.to`, no stream is returned for it.

## Repo layout

```
providers/desi-serials-to.js   # single hand-maintained scraper file
manifest.json                  # points Nuvio at the scraper
README.md
.gitignore
```

No build step, no tests, no package.json. The scraper is plain
JavaScript using Promise chains (Hermes-compatible — no async/await,
which Hermes does not support in dynamically loaded plugins without
transpilation).

## Local probe (optional)

```bash
node -c providers/desi-serials-to.js   # syntax check
node -e "const s = require('./providers/desi-serials-to.js'); console.log(typeof s.getStreams)"
```

For a live probe against a real TMDB ID, write a throwaway script that
calls `s.getStreams(tmdbId, "tv", season, episode)` and logs the result.
Do not commit probe scripts — they exercise live mirrors and depend on
network availability.
