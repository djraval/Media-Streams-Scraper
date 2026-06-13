# daily-soap-scraper

Downloads daily Hindi-serial episodes by walking public mirror sites in
order (`hubref.com` → `desitvbox.cfd` → `yodesi.net`) and writes them
into the current directory as `{Title} - YYYY-MM-DD.mp4`.

Auto-resumes by scanning the output folder for the latest date on disk.

## Requirements

- `uv` (https://docs.astral.sh/uv/)
- `ffmpeg` on `PATH`

## Use

```
cd /path/to/output/dir
uv run scraper.py
```

First run with an empty folder grabs the last 7 days. After that it
just downloads anything new.

Flags:

```
--show NAME            pick from the SHOWS dict (default: anupama)
--since YYYY-MM-DD     override resume point (use for first-run backfill)
--max N                cap downloads this run
--quality 720p         skip lower-quality backends (desitvbox is 360p)
--dry-run              show the worklist; don't download
--probe YYYY-MM-DD     try every backend against one date; no download
--out PATH             output directory (default: cwd)
```

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

## Adding a backend

Write an async function with this signature, append it to `BACKENDS`:

```python
async def newsite_backend(client, show, d: date) -> Source | None:
    ...
    return Source(parts=[Part(name=..., url=...)],
                  kind="mp4",  # or "hls"
                  quality="720p",
                  backend="newsite")
```

The resolver tries backends in list order; first non-None wins.

## Notes

- Single-stream per part. The Yandex CDN throttles per connection, so
  aria2's segmented download wouldn't help much.
- `desitvbox.cfd` is 360p. Use `--quality 720p` if you'd rather fail
  than silently drop quality.
- `yodesi.net` uses HLS with IP-bound tokens — fine when running on
  the user's machine; would not work from a different egress IP.
