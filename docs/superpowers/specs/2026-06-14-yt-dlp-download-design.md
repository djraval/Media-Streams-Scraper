# Design: yt-dlp download layer + thin extractors

**Date:** 2026-06-14
**Status:** Approved (design phase)
**Scope:** Replace the hand-rolled download/mux layer in `scraper.py` with yt-dlp (used as a download engine only), and couple resolution+download so a download failure falls back to the next backend. The three site scrapers in `backends.py` stay as thin URL-resolving extractors.

## Problem

The current downloader hand-rolls three things that yt-dlp does better:

- **MP4 streaming** — `stream_to_file()` streams direct URLs over `httpx` with no retry/resume/backoff.
- **HLS muxing** — `ffmpeg_hls()` shells out to `ffmpeg` to mux `.m3u8` → `.mp4` with manual `-headers` and `aac_adtstoasc`.
- **Branching** — `process_episode()` forks on `src.kind == "hls"` vs `"mp4"`, two divergent code paths.

These obscure sites (hubref, desitvbox/vkspeed, yodesi/tvlogy) have **no yt-dlp extractor**, so yt-dlp cannot replace the scraping. But once a backend resolves a concrete media URL, yt-dlp is a far more robust downloader: automatic retries with exponential backoff, per-fragment retry, resume, concurrent HLS fragments, and the m3u8 AAC fixup post-processor — for both `.mp4` and `.m3u8` through **one** options dict.

Additionally, today `resolve()` returns the *first backend that resolves a URL*. If that URL then fails to download, the whole episode fails even though a lower-priority backend might have worked. We fix that here.

## Goals

- Switch the download step to yt-dlp's Python library (`import yt_dlp`), invoked in-process.
- Collapse the mp4/hls branch into a single kind-agnostic download path.
- On a download failure, fall back to the next backend in priority order.
- Keep extraction (`backends.py`) and everything around download (discovery, locking, CLI, naming, atomic promotion) unchanged.
- Keep the test suite green and meaningful.

## Non-goals

- No yt-dlp site extractors / generic-extractor experiments — the custom scrapers stay.
- No change to episode discovery (`scan_dates`/`plan`), output naming (`{Title} - YYYY-MM-DD.mp4`), `OutputLock`, or the CLI flags (`--show`, `--out`, `--days`, `--probe`).
- No parallelism across episodes — episodes remain sequential (yt-dlp parallelizes *within* a download via fragments).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Rewrite scope | **Download layer + thin extractors** — backends resolve URLs, one shared yt-dlp downloader downloads. |
| yt-dlp invocation | **Python library** (`import yt_dlp`, `YoutubeDL(opts).download([url])` in-process). Added to inline `uv` script deps. |
| Test handling | **Update tests to match** — keep parsing tests, rewrite download tests against a mocked `yt_dlp.YoutubeDL`. |
| Download fallback | **Add download-failure fallback** — couple resolve+download; on `DownloadError`, try the next backend. |

## Architecture

### `backends.py` — unchanged contract

The backends already are thin extractors. Each returns:

```python
@dataclass
class Part:
    name: str
    url: str
    size: int = 0
    headers: dict = field(default_factory=dict)

@dataclass
class Source:
    parts: list[Part]
    kind: str        # "mp4" | "hls"  (retained for diagnostics/quality, no longer branches download)
    quality: str
    backend: str
```

- `hubref_backend` → `Source(kind="mp4", quality="720p")`, possibly **multiple** parts.
- `desitvbox_backend` → `Source(kind="mp4", quality="{n}p"|"unknown")`, single part.
- `yodesi_backend` → `Source(kind="hls", quality="480p")`, single part with `headers={"Referer": flow_url, "User-Agent": UA}`.

`BACKENDS = [hubref_backend, yodesi_backend, desitvbox_backend]` and `probe()` stay exactly as-is. `kind` is retained (it still labels the source and is used in probe diagnostics) but no longer selects a download code path.

### Resolution becomes an ordered generator

Replace `resolve()` (returns first source) with an async generator that **yields** sources in backend-priority order, so the caller can try the next backend if a download fails:

```python
# backends.py
async def iter_sources(
    client: httpx.AsyncClient, show: ShowConfig, d: date
) -> AsyncIterator[Source]:
    for backend in BACKENDS:
        src = await backend(client, show, d)
        if src is not None:
            # keep today's stderr quality warning here
            yield src
```

- `resolve()` is removed; `iter_sources()` replaces it. `probe()` is untouched (it already iterates `BACKENDS` with its own `ProbeLog`).
- Quality warnings that `resolve()` printed to stderr move into `iter_sources()`.

### `scraper.py` — new download layer

**Removed:** `stream_to_file()`, `ffmpeg_hls()`.
**Kept:** `ffmpeg_concat()` (yt-dlp cannot concatenate separate URLs), `promote_to_output()`, `scratch_part_path()`, `scan_dates()`, `plan()`, `OutputLock`, CLI/`main()`.
**Added:** `_ydl_opts(part, outtmpl)`, `ydl_download(part, dest_stem) -> Path`, and a rewritten `process_episode()` / `download_source()`.

#### One options dict for every part (mp4 and hls)

```python
import yt_dlp
from yt_dlp.utils import DownloadError

def _ydl_opts(part: Part, outtmpl: str) -> dict:
    return {
        "outtmpl": outtmpl,                       # into scratch, then promote
        "http_headers": {"User-Agent": UA, **part.headers},  # mirrors current merge; carries Referer
        "merge_output_format": "mp4",             # no-op for plain mp4; forces mp4 container for hls
        "hls_use_mpegts": False,                  # hls → mp4 (FFmpegFixupM3u8PP handles aac_adtstoasc)
        "retries": 10,
        "fragment_retries": 10,
        "file_access_retries": 5,
        "skip_unavailable_fragments": True,
        "continuedl": True,
        "concurrent_fragment_downloads": 4,
        "noplaylist": True,                       # defensive — never expand to a playlist
        "quiet": True,
        "no_warnings": True,
        "logger": _YdlLogger(),                   # routes yt-dlp output to stderr
        "progress_hooks": [_progress_hook],       # terse percent line to stderr
    }
```

`UA` is imported from `backends.py` (single source of truth for the User-Agent). The merge `{"User-Agent": UA, **part.headers}` reproduces today's `{**BROWSER_HEADERS, **part.headers}` semantics: yodesi's `Referer` survives; hubref/desitvbox (empty `part.headers`) just get the UA.

#### Download a part, then locate the real output

yt-dlp owns the file extension (it may rewrite `.ext`), so download into scratch with a templated stem and glob for the produced file:

```python
def ydl_download(part: Part, dest_stem: Path) -> Path:
    outtmpl = str(dest_stem.with_suffix("")) + ".%(ext)s"
    with yt_dlp.YoutubeDL(_ydl_opts(part, outtmpl)) as ydl:
        ydl.download([part.url])                  # raises DownloadError on failure
    produced = sorted(dest_stem.parent.glob(dest_stem.stem + ".*"))
    if not produced:
        raise DownloadError(f"yt-dlp produced no file for {part.url}")
    return produced[0]
```

Note `ydl_download` is **synchronous** (yt-dlp is blocking). It is called from async `process_episode()` via `asyncio.to_thread(...)` so the event loop is not blocked.

#### `download_source` — parts → final mp4

```python
async def download_source(src: Source, out: Path, scratch: Path, d: date) -> None:
    downloaded: list[Path] = []
    try:
        for i, part in enumerate(src.parts, 1):
            stem = scratch_part_path(scratch, d, i)   # reused helper
            downloaded.append(await asyncio.to_thread(ydl_download, part, stem))
        if len(downloaded) == 1:
            promote_to_output(downloaded[0], out)     # atomic rename, unchanged
        else:
            ffmpeg_concat(downloaded, out)            # multi-part, unchanged
    finally:
        for p in downloaded:
            p.unlink(missing_ok=True)
```

#### `process_episode` — fallback across backends

```python
async def process_episode(client, show, d, out_dir, scratch) -> tuple[bool, str]:
    out = out_dir / f"{show['title']} - {d.isoformat()}.mp4"
    async for src in iter_sources(client, show, d):
        try:
            await download_source(src, out, scratch, d)
            return True, f"{src.backend}/{src.quality}"
        except DownloadError as e:
            print(f"  {src.backend} resolved but download failed ({e}); "
                  f"trying next backend", file=sys.stderr)
            continue
    return False, "no backend"
```

This is strictly more reliable than today: a backend that resolves but whose URL is dead no longer dooms the episode.

### Data flow

```
_main(args)
  └─ for d in plan(scan_dates(out_dir), today, days):
       process_episode(client, show, d, out_dir, scratch)
         └─ async for src in iter_sources(client, show, d):   # hubref → yodesi → desitvbox
              try: await download_source(src, out, scratch, d)
                     └─ for part: await to_thread(ydl_download, part, stem)  # yt-dlp, one opts dict
                     └─ 1 part → promote_to_output ; N parts → ffmpeg_concat
                   return success
              except DownloadError: continue   # fall through to next backend
```

## Error handling

- `ydl_download` lets `DownloadError` propagate; `download_source` cleans up scratch parts in `finally`; `process_episode` catches `DownloadError` to drive fallback.
- A part that yields no file raises `DownloadError` (treated as a download failure → fallback).
- Non-`DownloadError` exceptions (programmer errors, unexpected) are **not** swallowed — they propagate and fail loudly.
- `_YdlLogger` routes yt-dlp's info/warn/error to stderr (respecting `quiet`); progress hook prints a terse percentage line to stderr via `print(..., file=sys.stderr)`, matching the current minimal output style.
- `OutputLock` and atomic `.partial`→rename promotion are unchanged, so partial/concurrent runs stay safe.

## Dependencies

- **Add** `yt-dlp` to the inline `# /// script` `dependencies` (alongside `httpx`). `uv run` installs it; no PATH binary required for yt-dlp itself.
- **ffmpeg** still required on PATH (yt-dlp drives it for HLS mux + post-processing fixup; we still use it for `ffmpeg_concat`). Keep the `shutil.which("ffmpeg")` startup guard.
- **httpx** stays — backends still scrape with it.

## Testing (`test_scraper.py` — update to match)

Keep all extractor/HTML-parsing/deobfuscation tests unchanged. Rewrite the download-layer tests:

1. **opts builder** — `_ydl_opts(part, outtmpl)` produces the expected dict: `outtmpl`, merged `http_headers` (UA always present; yodesi Referer preserved), `merge_output_format="mp4"`, `hls_use_mpegts=False`, retry knobs, `quiet/no_warnings`.
2. **single part → promote** — mock `yt_dlp.YoutubeDL` so `download()` writes a scratch file; assert `promote_to_output` is used and `ffmpeg_concat` is not.
3. **multi part → concat** — two parts; assert `ffmpeg_concat` receives both produced files in order.
4. **download failure → fallback** — first backend's `ydl_download` raises `DownloadError`; assert `process_episode` advances to the next yielded source and succeeds; assert scratch cleanup happened.
5. **all backends fail** — `iter_sources` yields nothing (or every download raises) → `(False, "no backend")`.
6. **kind-agnostic** — an `hls` part and an `mp4` part both go through the same `ydl_download`/opts path (no `src.kind` branch remains in the download code).

Mock boundary: patch `yt_dlp.YoutubeDL` (and `asyncio.to_thread` passthrough) so no network/ffmpeg runs in unit tests.

## Risks & mitigations

- **yt-dlp rewrites the output extension** → mitigated by download-to-scratch + glob-for-produced-file, then atomic promote.
- **yt-dlp's generic extractor mis-detects a CDN URL as a site** → `noplaylist=True` defensively; if ever needed, `allowed_extractors=['generic']` forces generic (documented fallback, not enabled by default).
- **Blocking yt-dlp call stalls the event loop** → run via `asyncio.to_thread`.
- **HLS still needs ffmpeg** → unchanged requirement; guard retained.

## Files touched

- `scraper.py` — remove `stream_to_file`/`ffmpeg_hls`; add `_ydl_opts`/`ydl_download`/`download_source`/`_YdlLogger`/`_progress_hook`; rewrite `process_episode`; add `yt-dlp` to inline deps; import `UA` from `backends`.
- `backends.py` — replace `resolve()` with `iter_sources()` async generator; move its quality warnings; `probe()`/`BACKENDS`/dataclasses/backends unchanged.
- `test_scraper.py` — rewrite download-layer tests per above; keep parsing tests.
