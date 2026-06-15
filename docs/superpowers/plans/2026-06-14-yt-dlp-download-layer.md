# yt-dlp Download Layer + Thin Extractors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `scraper.py`'s hand-rolled httpx/ffmpeg download+mux layer with yt-dlp (used as an in-process download engine only), collapse the mp4/hls branch into one code path, and fall back to the next backend when a download fails.

**Architecture:** The three site scrapers in `backends.py` stay as thin URL-resolving extractors. `resolve()` (returns the first source) is replaced by an async generator `iter_sources()` that yields sources in backend-priority order. `process_episode()` downloads the first source whose download succeeds; a `yt_dlp.utils.DownloadError` makes it fall through to the next backend. Every part — plain `.mp4` or `.m3u8` HLS — goes through one `yt_dlp.YoutubeDL` options dict; multi-part episodes are still concatenated with the retained `ffmpeg_concat`.

**Tech Stack:** Python 3.11+, `yt-dlp` (Python library), `httpx` (scraping, unchanged), `ffmpeg` on PATH (drives HLS mux + concat), `unittest` for tests, `uv` for running.

**Spec:** `docs/superpowers/specs/2026-06-14-yt-dlp-download-design.md`

---

## Environment notes (read before Task 1)

- Tests run with **`python3 -m unittest`** (system Python at `/usr`). `httpx` is already installed there; **`yt_dlp` is NOT**. Because `scraper.py` will gain a top-level `import yt_dlp`, the test interpreter must have it. **Task 0 installs it.**
- Production run is `uv run scraper.py ...`; `uv` reads the inline `# /// script` dependency block, so `yt-dlp` must be added there too (Task 1).
- Verification commands used throughout:
  - `python3 -m unittest -v` — full suite
  - `python3 -m unittest test_scraper.ClassName.test_name -v` — single test
  - `python3 -m py_compile scraper.py backends.py` — syntax check
  - `python3 scraper.py --help` — CLI smoke (works because `import yt_dlp` resolves after Task 0)

---

## File Structure

| File | Change | Responsibility after change |
|---|---|---|
| `scraper.py` | Modify | Discovery, locking, CLI unchanged. Download layer rewritten: add `_YdlLogger`, `_progress_hook`, `_ydl_opts`, `ydl_download`, rewrite `download_source`/`process_episode`. Remove `stream_to_file`, `ffmpeg_hls`. Keep `ffmpeg_concat`, `promote_to_output`, `scratch_part_path`, `_ffmpeg_run`. Add `yt-dlp` to inline deps; import `UA` from backends. |
| `backends.py` | Modify | Replace `resolve()` with async generator `iter_sources()` (moves its quality warning). `probe()`, `BACKENDS`, dataclasses, all three backends, helpers unchanged. |
| `test_scraper.py` | Modify | Keep all parsing/helper/probe/plan/scan tests. Rewrite `ScratchNamingTests` (it patches the now-deleted `stream_to_file`/`resolve`). Add `YdlOptsTests`, `DownloadSourceTests`, `FallbackTests`. |
| `README.md` | Modify | Mention yt-dlp dependency in the "Verify with" / requirements section. |

---

## Task 0: Install yt-dlp into the test interpreter

**Files:** none (environment setup).

- [ ] **Step 1: Confirm yt_dlp is missing, then install it**

Run:
```bash
python3 -c "import yt_dlp; print(yt_dlp.version.__version__)" 2>&1 | tail -1
```
Expected: `ModuleNotFoundError: No module named 'yt_dlp'`

Then install into the same interpreter that runs the tests:
```bash
python3 -m pip install --user yt-dlp
```
If `pip` is unavailable or the environment is externally managed, fall back to:
```bash
python3 -m pip install --user --break-system-packages yt-dlp
```

- [ ] **Step 2: Verify the import now works**

Run:
```bash
python3 -c "import yt_dlp; from yt_dlp.utils import DownloadError; print('yt_dlp', yt_dlp.version.__version__, 'OK')"
```
Expected: prints `yt_dlp <version> OK` with no traceback.

No commit (environment-only change).

---

## Task 1: Add yt-dlp to inline deps and wire imports

**Files:**
- Modify: `scraper.py:1-4` (inline deps), `scraper.py:24-53` (imports)

- [ ] **Step 1: Add yt-dlp to the inline `# /// script` dependency block**

Replace `scraper.py:1-4`:
```python
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
```
with:
```python
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "yt-dlp"]
# ///
```

- [ ] **Step 2: Add the yt_dlp imports**

In `scraper.py`, immediately after the existing `import httpx` line (`scraper.py:36`), add:
```python
import yt_dlp
from yt_dlp.utils import DownloadError
```

- [ ] **Step 3: Import `UA` from backends and drop the now-unused `resolve` import**

In the `from backends import (...)` block (`scraper.py:41-53`), make two edits:
- Add `UA,` to the imported names (keep `BROWSER_HEADERS` — `_main` still uses it for the httpx client).
- Remove the `resolve,` line (it will no longer exist after Task 4; `process_episode` will use `iter_sources`). Add `iter_sources,` in its place.

The block becomes:
```python
from backends import (
    BACKENDS,
    BROWSER_HEADERS,
    Part,
    Source,
    UA,
    desitvbox_backend,
    hubref_backend,
    iter_sources,
    probe,
    unpack,
    yadisk_resolve,
    yodesi_backend,
)
```

Note: `iter_sources` does not exist yet (created in Task 4). This import will fail until Task 4 lands. That is expected for an intermediate step — do NOT run the full suite between Task 1 and Task 4; the per-task verification below uses `py_compile` only, which does not execute imports.

- [ ] **Step 4: Verify the file still parses**

Run: `python3 -m py_compile scraper.py`
Expected: no output, exit 0. (`py_compile` checks syntax only; it does not resolve `iter_sources`, so this passes even though that name is not yet defined.)

- [ ] **Step 5: Commit**

```bash
git add scraper.py
git commit -m "build: add yt-dlp dependency and imports"
```

---

## Task 2: Add the yt-dlp logger and progress hook

**Files:**
- Modify: `scraper.py` (add after `scratch_part_path`, around `scraper.py:156`)
- Test: `test_scraper.py` (new `YdlOptsTests` class — logger portion)

- [ ] **Step 1: Write the failing test for the logger routing errors to stderr**

Add to `test_scraper.py` (place after the imports, e.g. before `class BackendHelperTests`):
```python
class YdlLoggerTests(unittest.TestCase):
    def test_logger_routes_warning_and_error_to_stderr(self):
        stderr = io.StringIO()
        with patch("sys.stderr", stderr):
            logger = scraper._YdlLogger()
            logger.debug("[debug] noisy internal line")
            logger.info("informational line")
            logger.warning("a warning")
            logger.error("a hard error")
        out = stderr.getvalue()
        self.assertIn("a warning", out)
        self.assertIn("a hard error", out)
        # debug/info are suppressed to keep output terse
        self.assertNotIn("noisy internal line", out)
        self.assertNotIn("informational line", out)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest test_scraper.YdlLoggerTests -v`
Expected: FAIL — `AttributeError: module 'scraper' has no attribute '_YdlLogger'`.

- [ ] **Step 3: Implement `_YdlLogger` and `_progress_hook`**

In `scraper.py`, add after `scratch_part_path` (after `scraper.py:155`) and before the `# --- Download + materialize ---` section:
```python
class _YdlLogger:
    """Route yt-dlp output to stderr. debug/info are dropped to stay terse;
    warnings and errors are surfaced (prefixed so they are recognizable)."""

    def debug(self, msg: str) -> None:        # yt-dlp sends info here too
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        print(f"  yt-dlp: {msg}", file=sys.stderr)

    def error(self, msg: str) -> None:
        print(f"  yt-dlp: {msg}", file=sys.stderr)


def _progress_hook(d: dict) -> None:
    if d.get("status") == "finished":
        name = d.get("filename", "")
        print(f"  fetched {name}", file=sys.stderr)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest test_scraper.YdlLoggerTests -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scraper.py test_scraper.py
git commit -m "feat: add yt-dlp logger and progress hook"
```

---

## Task 3: Add the `_ydl_opts` options builder

**Files:**
- Modify: `scraper.py` (add after `_progress_hook`)
- Test: `test_scraper.py` (new `YdlOptsTests` class)

- [ ] **Step 1: Write the failing test for the options dict**

Add to `test_scraper.py`:
```python
class YdlOptsTests(unittest.TestCase):
    def test_opts_for_plain_mp4_part(self):
        part = scraper.Part(name="p1", url="https://cdn/x.mp4")
        opts = scraper._ydl_opts(part, "/scratch/out.%(ext)s")
        self.assertEqual(opts["outtmpl"], "/scratch/out.%(ext)s")
        # UA always present; no Referer for a headerless part
        self.assertEqual(opts["http_headers"]["User-Agent"], backends.UA)
        self.assertNotIn("Referer", opts["http_headers"])
        self.assertEqual(opts["merge_output_format"], "mp4")
        self.assertFalse(opts["hls_use_mpegts"])
        self.assertTrue(opts["quiet"])
        self.assertTrue(opts["no_warnings"])
        self.assertTrue(opts["noplaylist"])
        # robustness knobs present
        self.assertGreaterEqual(opts["retries"], 1)
        self.assertGreaterEqual(opts["fragment_retries"], 1)

    def test_opts_preserve_part_headers_including_referer(self):
        part = scraper.Part(
            name="hls",
            url="https://cdn/x.m3u8",
            headers={"Referer": "https://flow/player", "User-Agent": "custom-UA"},
        )
        opts = scraper._ydl_opts(part, "/scratch/out.%(ext)s")
        self.assertEqual(opts["http_headers"]["Referer"], "https://flow/player")
        # part headers override the default UA (matches old {**BROWSER_HEADERS, **part.headers})
        self.assertEqual(opts["http_headers"]["User-Agent"], "custom-UA")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest test_scraper.YdlOptsTests -v`
Expected: FAIL — `AttributeError: module 'scraper' has no attribute '_ydl_opts'`.

- [ ] **Step 3: Implement `_ydl_opts`**

In `scraper.py`, add after `_progress_hook`:
```python
def _ydl_opts(part: Part, outtmpl: str) -> dict:
    """One options dict for every part, plain mp4 or HLS alike.

    `merge_output_format="mp4"` is a no-op for a plain mp4 and forces an mp4
    container for HLS; `hls_use_mpegts=False` makes yt-dlp rewrap HLS to mp4
    (its FFmpegFixupM3u8PP applies the aac_adtstoasc fix we used to do by hand).
    Header merge mirrors the old `{**BROWSER_HEADERS, **part.headers}`: the
    default UA is present, and a part's own headers (e.g. yodesi's Referer)
    win on conflict.
    """
    return {
        "outtmpl": outtmpl,
        "http_headers": {"User-Agent": UA, **part.headers},
        "merge_output_format": "mp4",
        "hls_use_mpegts": False,
        "retries": 10,
        "fragment_retries": 10,
        "file_access_retries": 5,
        "skip_unavailable_fragments": True,
        "continuedl": True,
        "concurrent_fragment_downloads": 4,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "logger": _YdlLogger(),
        "progress_hooks": [_progress_hook],
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest test_scraper.YdlOptsTests -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add scraper.py test_scraper.py
git commit -m "feat: add yt-dlp options builder"
```

---

## Task 4: Replace `resolve()` with `iter_sources()` generator

**Files:**
- Modify: `backends.py:657-674` (replace `resolve`), `backends.py:13` (typing import)

- [ ] **Step 1: Write the failing test for ordered yielding**

Add to `test_scraper.py`:
```python
class IterSourcesTests(unittest.TestCase):
    def _src(self, backend, quality="720p"):
        return backends.Source(
            parts=[backends.Part(name="p", url="u")],
            kind="mp4", quality=quality, backend=backend,
        )

    def test_yields_each_resolving_backend_in_priority_order(self):
        async def b_hub(client, show, d):  return self._src("hubref")
        async def b_yod(client, show, d):  return None
        async def b_dtb(client, show, d):  return self._src("desitvbox", "480p")

        async def collect():
            got = []
            with patch.object(backends, "BACKENDS", [b_hub, b_yod, b_dtb]):
                async for s in backends.iter_sources(object(), {"title": "X"}, date(2026, 6, 14)):
                    got.append(s.backend)
            return got

        with patch("sys.stderr", io.StringIO()):
            order = asyncio.run(collect())
        self.assertEqual(order, ["hubref", "desitvbox"])

    def test_crashing_backend_is_skipped(self):
        async def b_boom(client, show, d):  raise RuntimeError("boom")
        async def b_ok(client, show, d):    return self._src("yodesi")

        async def collect():
            got = []
            with patch.object(backends, "BACKENDS", [b_boom, b_ok]):
                async for s in backends.iter_sources(object(), {"title": "X"}, date(2026, 6, 14)):
                    got.append(s.backend)
            return got

        with patch("sys.stderr", io.StringIO()):
            order = asyncio.run(collect())
        self.assertEqual(order, ["yodesi"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest test_scraper.IterSourcesTests -v`
Expected: FAIL — `AttributeError: module 'backends' has no attribute 'iter_sources'`.

- [ ] **Step 3: Add the `AsyncIterator` import**

In `backends.py:13`, change:
```python
from collections.abc import Awaitable, Callable, Iterable
```
to:
```python
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
```

- [ ] **Step 4: Replace `resolve()` with `iter_sources()`**

Replace `backends.py:657-674` (the entire `async def resolve(...)` function) with:
```python
async def iter_sources(
    client: httpx.AsyncClient, show: ShowConfig, d: date
) -> AsyncIterator[Source]:
    """Yield resolvable sources in backend-priority order.

    Unlike the old `resolve()` (which returned only the first hit), this lets
    the caller try the next backend if a resolved URL fails to download.
    """
    for backend in BACKENDS:
        try:
            src = await backend(client, show, d)
        except Exception as exc:  # noqa: BLE001
            print(f"  [{d}] {backend.__name__} crashed: {exc!s}", file=sys.stderr)
            continue
        if src is None:
            continue
        if src.quality != "720p":
            print(
                f"  [{d}] WARN: only {src.quality} available ({src.backend}).",
                file=sys.stderr,
            )
        yield src
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python3 -m unittest test_scraper.IterSourcesTests -v`
Expected: PASS (both tests).

- [ ] **Step 6: Verify both modules still compile**

Run: `python3 -m py_compile scraper.py backends.py`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add backends.py test_scraper.py
git commit -m "feat: replace resolve() with iter_sources() generator"
```

---

## Task 5: Add `ydl_download` (one part → one file)

**Files:**
- Modify: `scraper.py` (add after `_ydl_opts`)
- Test: `test_scraper.py` (new `YdlDownloadTests` class)

- [ ] **Step 1: Write the failing tests**

Add to `test_scraper.py`:
```python
class YdlDownloadTests(unittest.TestCase):
    def test_returns_the_file_yt_dlp_produced(self):
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            stem = scratch / "2026-06-14-part01"

            class FakeYDL:
                def __init__(self, opts): self.opts = opts
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def download(self, urls):
                    # yt-dlp owns the extension; simulate it choosing .mp4
                    (stem.parent / (stem.name + ".mp4")).write_bytes(b"video")
                    return 0

            part = scraper.Part(name="p1", url="https://cdn/x.mp4")
            with patch.object(scraper.yt_dlp, "YoutubeDL", FakeYDL):
                produced = scraper.ydl_download(part, stem)
            self.assertEqual(produced, stem.parent / "2026-06-14-part01.mp4")
            self.assertEqual(produced.read_bytes(), b"video")

    def test_raises_downloaderror_when_no_file_produced(self):
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            stem = scratch / "2026-06-14-part01"

            class FakeYDL:
                def __init__(self, opts): pass
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def download(self, urls): return 0  # writes nothing

            part = scraper.Part(name="p1", url="https://cdn/x.mp4")
            with patch.object(scraper.yt_dlp, "YoutubeDL", FakeYDL):
                with self.assertRaises(scraper.DownloadError):
                    scraper.ydl_download(part, stem)

    def test_passes_outtmpl_and_headers_to_yt_dlp(self):
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            stem = scratch / "2026-06-14-part01"
            captured = {}

            class FakeYDL:
                def __init__(self, opts): captured["opts"] = opts
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def download(self, urls):
                    captured["urls"] = urls
                    (stem.parent / (stem.name + ".mp4")).write_bytes(b"v")
                    return 0

            part = scraper.Part(
                name="p1", url="https://cdn/x.m3u8",
                headers={"Referer": "https://flow"},
            )
            with patch.object(scraper.yt_dlp, "YoutubeDL", FakeYDL):
                scraper.ydl_download(part, stem)
            self.assertEqual(captured["urls"], ["https://cdn/x.m3u8"])
            self.assertTrue(captured["opts"]["outtmpl"].endswith(".%(ext)s"))
            self.assertIn("2026-06-14-part01", captured["opts"]["outtmpl"])
            self.assertEqual(
                captured["opts"]["http_headers"]["Referer"], "https://flow"
            )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest test_scraper.YdlDownloadTests -v`
Expected: FAIL — `AttributeError: module 'scraper' has no attribute 'ydl_download'`.

- [ ] **Step 3: Implement `ydl_download`**

In `scraper.py`, add after `_ydl_opts`:
```python
def ydl_download(part: Part, dest_stem: Path) -> Path:
    """Download one part with yt-dlp into <dest_stem>.<ext-chosen-by-yt-dlp>,
    then return the file that was actually produced.

    Synchronous (yt-dlp blocks); call from async code via asyncio.to_thread.
    Raises DownloadError on failure or if no output file appears.
    """
    outtmpl = str(dest_stem) + ".%(ext)s"
    with yt_dlp.YoutubeDL(_ydl_opts(part, outtmpl)) as ydl:
        ydl.download([part.url])
    produced = sorted(dest_stem.parent.glob(dest_stem.name + ".*"))
    # ignore any stray .partial/.ytdl/.part leftovers; want the finished file
    produced = [p for p in produced if p.suffix not in (".partial", ".part", ".ytdl")]
    if not produced:
        raise DownloadError(f"yt-dlp produced no file for {part.url}")
    return produced[0]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m unittest test_scraper.YdlDownloadTests -v`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add scraper.py test_scraper.py
git commit -m "feat: add ydl_download single-part downloader"
```

---

## Task 6: Add `download_source` and rewrite `process_episode`

**Files:**
- Modify: `scraper.py:251-280` (rewrite `process_episode`, add `download_source` before it)
- Test: `test_scraper.py` — rewrite `ScratchNamingTests`, add `DownloadSourceTests` + `FallbackTests`

- [ ] **Step 1: Rewrite the existing `ScratchNamingTests` for the new internals**

The current `ScratchNamingTests` (`test_scraper.py:360-414`) patches `scraper.resolve` and `scraper.stream_to_file`, both of which no longer exist. Replace the entire `class ScratchNamingTests(unittest.TestCase):` block with:
```python
class ScratchNamingTests(unittest.TestCase):
    def test_process_episode_uses_local_part_names_inside_scratch(self):
        async def fake_iter_sources(client, show, d):
            yield scraper.Source(
                parts=[
                    scraper.Part(name="../escape.mp4", url="https://example/1"),
                    scraper.Part(name="/tmp/escape.mp4", url="https://example/2"),
                ],
                kind="mp4",
                quality="720p",
                backend="fake",
            )

        seen_stems = []

        def fake_ydl_download(part, dest_stem):
            seen_stems.append(dest_stem)
            produced = dest_stem.parent / (dest_stem.name + ".mp4")
            produced.write_bytes(b"v")
            return produced

        concat_inputs = []

        def fake_ffmpeg_concat(parts, out):
            concat_inputs.extend(parts)
            out.write_bytes(b"merged")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = root / "out"
            scratch = out_dir / ".scratch" / "run-123"
            out_dir.mkdir()
            scratch.mkdir(parents=True)

            with (
                patch.object(scraper, "iter_sources", fake_iter_sources),
                patch.object(scraper, "ydl_download", fake_ydl_download),
                patch.object(scraper, "ffmpeg_concat", fake_ffmpeg_concat),
            ):
                success, msg = asyncio.run(
                    scraper.process_episode(
                        object(),
                        {"title": "Anupamaa"},
                        date(2026, 6, 14),
                        out_dir,
                        scratch,
                    )
                )

        expected = [
            scratch / "2026-06-14-part01",
            scratch / "2026-06-14-part02",
        ]
        self.assertTrue(success)
        self.assertEqual(msg, "fake/720p")
        self.assertEqual(seen_stems, expected)
        self.assertEqual(
            concat_inputs,
            [scratch / "2026-06-14-part01.mp4", scratch / "2026-06-14-part02.mp4"],
        )
```

Note: `scratch_part_path` returns a path ending in `.mp4` today (`scraper.py:154-155`). In Task 6 Step 4 we pass a **stem** (no extension) to `ydl_download`, so `download_source` must strip the `.mp4` suffix from `scratch_part_path` before calling `ydl_download`. The test above asserts stems without `.mp4` (`2026-06-14-part01`), and concat inputs with `.mp4` (what `ydl_download` produced).

- [ ] **Step 2: Add the new `DownloadSourceTests` (single-part promote) and `FallbackTests`**

Add to `test_scraper.py`:
```python
class DownloadSourceTests(unittest.TestCase):
    def test_single_part_is_promoted_not_concatenated(self):
        produced_log = []
        concat_called = []

        def fake_ydl_download(part, dest_stem):
            p = dest_stem.parent / (dest_stem.name + ".mp4")
            p.write_bytes(b"single")
            produced_log.append(p)
            return p

        def fake_concat(parts, out):
            concat_called.append(parts)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = root / "out"; out_dir.mkdir()
            scratch = out_dir / ".scratch" / "run-1"; scratch.mkdir(parents=True)
            out = out_dir / "Anupamaa - 2026-06-14.mp4"
            src = scraper.Source(
                parts=[scraper.Part(name="p", url="https://cdn/x.mp4")],
                kind="mp4", quality="720p", backend="hubref",
            )
            with (
                patch.object(scraper, "ydl_download", fake_ydl_download),
                patch.object(scraper, "ffmpeg_concat", fake_concat),
            ):
                asyncio.run(
                    scraper.download_source(src, out, scratch, date(2026, 6, 14))
                )
            self.assertTrue(out.exists())
            self.assertEqual(out.read_bytes(), b"single")
            self.assertEqual(concat_called, [])  # never concatenated for 1 part
            # scratch part cleaned up
            self.assertFalse(produced_log[0].exists())


class FallbackTests(unittest.TestCase):
    def test_download_failure_falls_through_to_next_backend(self):
        async def fake_iter_sources(client, show, d):
            yield scraper.Source(
                parts=[scraper.Part(name="p", url="https://dead/x.mp4")],
                kind="mp4", quality="720p", backend="hubref",
            )
            yield scraper.Source(
                parts=[scraper.Part(name="p", url="https://live/x.mp4")],
                kind="mp4", quality="480p", backend="desitvbox",
            )

        attempts = []

        def fake_ydl_download(part, dest_stem):
            attempts.append(part.url)
            if part.url == "https://dead/x.mp4":
                raise scraper.DownloadError("dead url")
            p = dest_stem.parent / (dest_stem.name + ".mp4")
            p.write_bytes(b"ok")
            return p

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = root / "out"; out_dir.mkdir()
            scratch = out_dir / ".scratch" / "run-1"; scratch.mkdir(parents=True)
            with (
                patch.object(scraper, "iter_sources", fake_iter_sources),
                patch.object(scraper, "ydl_download", fake_ydl_download),
                patch("sys.stderr", io.StringIO()),
            ):
                success, msg = asyncio.run(
                    scraper.process_episode(
                        object(), {"title": "Anupamaa"},
                        date(2026, 6, 14), out_dir, scratch,
                    )
                )
            self.assertTrue(success)
            self.assertEqual(msg, "desitvbox/480p")
            self.assertEqual(
                attempts, ["https://dead/x.mp4", "https://live/x.mp4"]
            )
            self.assertTrue((out_dir / "Anupamaa - 2026-06-14.mp4").exists())

    def test_all_backends_failing_returns_no_backend(self):
        async def empty_iter(client, show, d):
            return
            yield  # pragma: no cover  (makes this an async generator)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = root / "out"; out_dir.mkdir()
            scratch = out_dir / ".scratch" / "run-1"; scratch.mkdir(parents=True)
            with (
                patch.object(scraper, "iter_sources", empty_iter),
                patch("sys.stderr", io.StringIO()),
            ):
                success, msg = asyncio.run(
                    scraper.process_episode(
                        object(), {"title": "Anupamaa"},
                        date(2026, 6, 14), out_dir, scratch,
                    )
                )
            self.assertFalse(success)
            self.assertEqual(msg, "no backend")

    def test_every_source_download_fails_returns_no_backend(self):
        async def fake_iter_sources(client, show, d):
            yield scraper.Source(
                parts=[scraper.Part(name="p", url="https://a/x.mp4")],
                kind="mp4", quality="720p", backend="hubref",
            )
            yield scraper.Source(
                parts=[scraper.Part(name="p", url="https://b/x.mp4")],
                kind="hls", quality="480p", backend="yodesi",
            )

        def always_fail(part, dest_stem):
            raise scraper.DownloadError("nope")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out_dir = root / "out"; out_dir.mkdir()
            scratch = out_dir / ".scratch" / "run-1"; scratch.mkdir(parents=True)
            with (
                patch.object(scraper, "iter_sources", fake_iter_sources),
                patch.object(scraper, "ydl_download", always_fail),
                patch("sys.stderr", io.StringIO()),
            ):
                success, msg = asyncio.run(
                    scraper.process_episode(
                        object(), {"title": "Anupamaa"},
                        date(2026, 6, 14), out_dir, scratch,
                    )
                )
            self.assertFalse(success)
            self.assertEqual(msg, "no backend")
```

- [ ] **Step 3: Run the new/changed tests to verify they fail**

Run:
```bash
python3 -m unittest test_scraper.ScratchNamingTests test_scraper.DownloadSourceTests test_scraper.FallbackTests -v
```
Expected: FAIL — `download_source` does not exist yet, and `process_episode` still calls `resolve`/`stream_to_file`.

- [ ] **Step 4: Implement `download_source` and rewrite `process_episode`**

Replace `scraper.py:251-280` (the entire current `async def process_episode(...)`) with:
```python
async def download_source(
    src: Source, out: Path, scratch: Path, d: date
) -> None:
    """Download every part of one source with yt-dlp, then materialize `out`:
    single part -> atomic promote; multiple parts -> ffmpeg concat.
    Raises DownloadError if any part fails (caller falls back to next source).
    """
    downloaded: list[Path] = []
    try:
        for i, part in enumerate(src.parts, 1):
            stem = scratch_part_path(scratch, d, i).with_suffix("")
            downloaded.append(await asyncio.to_thread(ydl_download, part, stem))
        if len(downloaded) == 1:
            promote_to_output(downloaded[0], out)
        else:
            ffmpeg_concat(downloaded, out)
    finally:
        for p in downloaded:
            p.unlink(missing_ok=True)


async def process_episode(
    client: httpx.AsyncClient,
    show: dict,
    d: date,
    out_dir: Path,
    scratch: Path,
) -> tuple[bool, str]:
    out = out_dir / f"{show['title']} - {d.isoformat()}.mp4"
    async for src in iter_sources(client, show, d):
        try:
            await download_source(src, out, scratch, d)
        except DownloadError as e:
            print(
                f"  {src.backend} resolved but download failed ({e}); "
                f"trying next backend",
                file=sys.stderr,
            )
            continue
        return True, f"{src.backend}/{src.quality}"
    return False, "no backend"
```

- [ ] **Step 5: Run the changed tests to verify they pass**

Run:
```bash
python3 -m unittest test_scraper.ScratchNamingTests test_scraper.DownloadSourceTests test_scraper.FallbackTests -v
```
Expected: PASS (all tests across the three classes).

- [ ] **Step 6: Commit**

```bash
git add scraper.py test_scraper.py
git commit -m "feat: yt-dlp download_source with backend fallback"
```

---

## Task 7: Remove the dead download functions

**Files:**
- Modify: `scraper.py` — delete `stream_to_file` (`scraper.py:163-178`), `ffmpeg_hls` (`scraper.py:240-248`), and the now-unused `CHUNK` constant (`scraper.py:160`)

- [ ] **Step 1: Confirm nothing references them anymore**

Run:
```bash
grep -n "stream_to_file\|ffmpeg_hls\|\bCHUNK\b" scraper.py test_scraper.py backends.py
```
Expected: no matches in `scraper.py` (outside the definitions themselves) and **no matches at all** in `test_scraper.py` / `backends.py`. If any non-definition reference remains, stop and fix it before deleting.

- [ ] **Step 2: Delete `stream_to_file`**

Remove the entire function `async def stream_to_file(...) -> Path:` (originally `scraper.py:163-178`, including its body and the blank line after).

- [ ] **Step 3: Delete `ffmpeg_hls`**

Remove the entire function `def ffmpeg_hls(part: Part, out: Path) -> None:` (originally `scraper.py:240-248`).

- [ ] **Step 4: Delete the unused `CHUNK` constant**

Remove `CHUNK = 1 << 20` and its surrounding blank lines (originally `scraper.py:160`). `CHUNK` was only used by `stream_to_file`.

- [ ] **Step 5: Verify compile + full suite**

Run:
```bash
python3 -m py_compile scraper.py backends.py
python3 -m unittest -v
```
Expected: compile clean; **all tests PASS** (this is the first full-suite run since Task 1 — the `iter_sources` import is now satisfied).

- [ ] **Step 6: CLI smoke test**

Run: `python3 scraper.py --help`
Expected: argparse help text prints (proves `import yt_dlp` resolves and the module loads end-to-end).

- [ ] **Step 7: Commit**

```bash
git add scraper.py
git commit -m "refactor: remove httpx streaming and ffmpeg_hls (replaced by yt-dlp)"
```

---

## Task 8: Update README and run final verification

**Files:**
- Modify: `README.md` (requirements / verify section)

- [ ] **Step 1: Note the yt-dlp dependency in README**

Find the requirements/dependencies section of `README.md` (near the run instructions, and the "Verify with" block around `README.md:165`). Add a line noting that the scraper now requires **yt-dlp** (installed automatically by `uv run` via the inline script deps; for bare `python3` runs install it with `pip install yt-dlp`) and that **ffmpeg** is still required on PATH for HLS muxing and multi-part concatenation. Keep the existing `python3 -m unittest` / `py_compile` / `--help` verify commands.

Concretely, locate the line listing external requirements (search for `ffmpeg` in `README.md`) and ensure both tools are listed, e.g.:
```markdown
Requirements: `ffmpeg` on PATH, and `yt-dlp` (auto-installed by `uv run`;
for plain `python3` use `pip install yt-dlp`).
```
If no such requirements line exists, add it just above the "Verify with" block.

- [ ] **Step 2: Run the full verification gauntlet**

Run:
```bash
python3 -m unittest -v
python3 -m py_compile scraper.py backends.py
python3 scraper.py --help
```
Expected: all tests PASS; compile clean; help prints.

- [ ] **Step 3: Live smoke test (probe, no download)**

`--probe` exercises the backends and `probe()` without downloading. Pick a recent date:
```bash
python3 scraper.py --probe 2026-06-13
```
Expected: per-backend probe lines on stderr (OK/no source/crashed). Network-dependent — if a mirror is down a backend may report "no source"; that is acceptable for a smoke test. This confirms `probe()` and the backends still work after the refactor.

- [ ] **Step 4: Live end-to-end download (one episode, optional but recommended)**

Download into a throwaway dir to confirm the yt-dlp path actually produces a playable file:
```bash
mkdir -p /tmp/anupama-smoke
python3 scraper.py --out /tmp/anupama-smoke --days 1
ls -la /tmp/anupama-smoke/*.mp4
```
Expected: at least one `Anupamaa - YYYY-MM-DD.mp4` of non-trivial size (tens of MB+). If a backend's URL is dead, the new fallback should try the next backend (watch stderr for "trying next backend"). If all mirrors are down at smoke time, note it and rely on the unit suite + probe; do not block the task on flaky mirror availability.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: note yt-dlp + ffmpeg requirements"
```

---

## Self-Review Checklist (performed during plan authoring)

**Spec coverage:**
- yt-dlp Python library, in-process → Tasks 1, 3, 5 ✓
- One kind-agnostic opts dict (mp4+hls) → Task 3 (`_ydl_opts`), Task 5 (`ydl_download`) ✓
- Collapse `src.kind` branch → Task 6 `process_episode`/`download_source` (no kind branch) ✓
- `resolve()` → `iter_sources()` generator → Task 4 ✓
- Download-failure fallback across backends → Task 6 `process_episode` + `FallbackTests` ✓
- Keep `ffmpeg_concat`, `promote_to_output`, discovery, lock, CLI → untouched (verified by full suite, Task 7) ✓
- Headers/Referer threading → Task 3 test `test_opts_preserve_part_headers_including_referer` ✓
- `asyncio.to_thread` for blocking yt-dlp → Task 6 `download_source` ✓
- Add yt-dlp to inline deps → Task 1 ✓
- ffmpeg guard retained → unchanged in `_main`, verified by `RunSafetyTests` still passing ✓
- Tests: keep parsing, rewrite download tests → Tasks 2–6 ✓
- Risk: yt-dlp rewrites extension → Task 5 glob-for-produced-file ✓
- Risk: generic extractor mis-detect → `noplaylist` in Task 3 ✓
- README dependency note → Task 8 ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type/name consistency:** `_YdlLogger`, `_progress_hook`, `_ydl_opts(part, outtmpl)`, `ydl_download(part, dest_stem) -> Path`, `download_source(src, out, scratch, d)`, `iter_sources(client, show, d)`, `process_episode(client, show, d, out_dir, scratch)` — names/signatures consistent across Tasks 2–8 and tests. `scratch_part_path(...).with_suffix("")` (stem) reconciled between Task 6 implementation and `ScratchNamingTests` expectations. ✓

**Ordering note:** `scraper.py` is intentionally non-runnable as a whole between Task 1 (imports `iter_sources`) and Task 4 (defines it). Per-task verification in that window uses `py_compile` only; the first full `unittest` run is Task 7 Step 5, after all symbols exist. Individual test classes added in Tasks 2–5 target functions that already exist at those points and pass when run in isolation. ✓
