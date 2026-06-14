# daily-soap-scraper

Downloads daily Hindi-serial episodes by walking public mirror sites in
order (`hubref.com` → `desitvbox.cfd` → `yodesi.net`) and writes them
into the current directory as `{Title} - YYYY-MM-DD.mp4`.

Auto-resumes by scanning the output folder and keeping the last N days filled.

## Requirements

- `uv` (https://docs.astral.sh/uv/)
- `ffmpeg` on `PATH`

## Use

```
cd /path/to/output/dir
uv run scraper.py
```

Each run downloads whatever is missing from the last 7 days, so it
auto-resumes and backfills any gaps. Want a bigger window (e.g. a
one-time 14-day backfill)? Use `--days 14`.

Flags:

```
--show NAME            pick from the SHOWS dict (default: anupama)
--out PATH             output directory (default: cwd)
--days N               keep the last N days filled (default: 7)
--probe YYYY-MM-DD     try every backend against one date; no download
```

## Pi/Plex cron

For unattended Raspberry Pi use, point `--out` at the folder Plex scans and
use a wider fill window so a missed run catches up cleanly:

```
17 3 * * * cd /path/to/anupama-feed && uv run scraper.py --out /path/to/Plex/Anupamaa --days 14
```

To check one date without downloading, run:

```
uv run scraper.py --probe YYYY-MM-DD
```

Concurrent download runs for the same output directory exit successfully as a
no-op, which keeps cron quiet if an earlier run is still active.

## Adding a show

Append a dict entry to `SHOWS` near the top of `scraper.py`:

```python
SHOWS = {
    "anupama": { ... },
    "yrkkh": {
        "title": "Yeh Rishta Kya Kehlata Hai",
        "slugs": {
            "hubref":    "yeh-rishta-kya-kehlata-hai",
            "desitvbox": "yeh-rishta-kya-kehlata-hai",
            "yodesi":    "yeh-rishta-kya-kehlata-hai",
        },
    },
}
```

Then `--show yrkkh`.

## Maintaining backends

Backend-specific page fetching, source resolution, parser helpers, and the
shared `Part`/`Source` data structures live in `backends.py`. `scraper.py` stays
focused on the CLI, planning, locking, scratch files, downloads, and ffmpeg.

Write an async backend function with this signature, append it to `BACKENDS` in
`backends.py`, and use `--probe YYYY-MM-DD` to inspect candidate counts and URLs
when mirror markup changes:

```python
async def newsite_backend(client, show, d: date) -> Source | None:
    ...
    return Source(parts=[Part(name=..., url=...)],
                  kind="mp4",  # or "hls"
                  quality="720p",
                  backend="newsite")
```

The resolver tries backends in list order; first non-None wins. Keep candidate
extraction broad, but only return a `Source` for direct MP4, HLS playlists,
Yandex-resolved links, or known player-derived media URLs.

## Notes

- Single-stream per part. The Yandex CDN throttles per connection, so
  aria2's segmented download wouldn't help much.
- `yodesi.net` uses HLS with IP-bound tokens — fine when running on
  the user's machine; would not work from a different egress IP.

<!-- AGENT-NOTES-START -->
## Agent Notes (Removable)

This section is for coding agents picking up maintenance work. It is deliberately
at the bottom so it can be deleted without changing user-facing usage docs.

### Quick Usage

```bash
uv run scraper.py
uv run scraper.py --out /path/to/Plex/Anupamaa --days 14
uv run scraper.py --probe YYYY-MM-DD
```

`--probe` is the main debugging path. It fetches mirror pages and reports backend
steps, candidate counts, and resolved URLs, but it does not download or run
ffmpeg. Use it before changing backend parsing.

### Source Layout

This is intended to stay script-like, not become a package:

- `scraper.py` is the CLI entrypoint. Keep argument parsing, planning, output
  locking, scratch directories, downloads, and ffmpeg materialization here.
- `backends.py` owns where episode URLs come from. It contains `Part`, `Source`,
  parser helpers, backend-specific fetch/resolve logic, `resolve()`, and
  `probe()`.
- `test_scraper.py` contains unit tests with mocked HTTP responses. Tests should
  not depend on live mirror sites.

Avoid adding package directories, plugin systems, database state, API keys, cloud
LLM calls, or cron-time source discovery. This scraper is deterministic by
choice.

### Secrets And Optional Metadata

Claude project memory mentions TMDB credentials for possible Anupamaa metadata
work. The current scraper does not need TMDB. If metadata support is added later,
load credentials from environment variables or local config only; never commit
API keys, bearer tokens, or generated credential files.

### Design Decisions

Backend extraction should be broad, but source validation should stay strict.
Only return a `Source` for direct MP4 URLs, HLS playlists, Yandex-resolved links,
or known player-derived media URLs.

`BACKENDS` order matters. Higher-quality or preferred sources should come first;
`resolve()` returns the first usable source and warns when quality is below
`720p`.

Do not make failed backend recovery guess new websites. If all known backends
fail, keep the existing failure behavior and improve `--probe` diagnostics so a
human can repair the backend quickly.

### Backend Maintenance Flow

1. Reproduce with `uv run scraper.py --probe YYYY-MM-DD` or
   `python3 scraper.py --probe YYYY-MM-DD`.
2. Update helpers or backend-specific parsing in `backends.py`.
3. Add or adjust mocked tests in `test_scraper.py` with small inline HTML/player
   samples. Cover nearby markup changes rather than exact old markup only.
4. Verify with:

```bash
python3 -m unittest
python3 -m py_compile scraper.py backends.py
python3 scraper.py --help
```

A live `--probe` is useful as a final smoke test, but keep it out of automated
unit tests because mirror sites change and network availability is not stable.

### Safety Notes

Downloads write through `.partial` files and use a per-run `.scratch/run-*`
directory. Do not write downloaded parts directly into the output directory.
Keep the output lock behavior: concurrent runs for the same output directory
should exit successfully as a no-op.

When changing filename handling, preserve exact episode matching:
`{Title} - YYYY-MM-DD.mp4`. Do not let partial files, prefixed filenames, or
other shows count as completed episodes.
<!-- AGENT-NOTES-END -->
