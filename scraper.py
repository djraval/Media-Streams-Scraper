# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "yt-dlp"]
# ///
"""daily-soap-scraper - download daily Hindi-serial episodes.

Walks several public mirror sites (hubref.com -> desitvbox.cfd -> yodesi.net)
and downloads each missing episode for a given show. Output files land in the
current directory as `{Title} - YYYY-MM-DD.mp4`.

Discovery is filesystem-based: scan the output dir for already-downloaded
files and keep the last N days filled. No external state.

Add a show:    append a dict entry to SHOWS.
Add a backend: write `async fn(client, show, date) -> Source | None` in
               backends.py and append it to BACKENDS. First non-None wins.

Usage:
  uv run scraper.py [--show NAME] [--out PATH] [--days N] [--probe YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import asyncio
import fcntl
import os
import re
import shutil
import subprocess
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path

import httpx
import yt_dlp
from yt_dlp.utils import DownloadError

# Backends, the helpers they use, and the Part/Source shapes all live in
# backends.py. Re-imported here for the CLI and for older local scripts that
# imported these names from scraper.py.
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


# --- Show registry ---------------------------------------------------------

SHOWS: dict[str, dict] = {
    "anupama": {
        "title": "Anupamaa",
        "slugs": {
            "hubref":    "anupama",
            "desitvbox": "anupama",
            "yodesi":    "anupamaa",
        },
    },
}


# --- Discovery ------------------------------------------------------------

def scan_dates(out_dir: Path, title: str) -> set[date]:
    if not out_dir.is_dir():
        return set()
    pat = re.compile(
        r"^" + re.escape(title) + r" - (\d{4})-(\d{2})-(\d{2})\.mp4$",
        re.IGNORECASE,
    )
    found: set[date] = set()
    for f in out_dir.iterdir():
        m = pat.match(f.name)
        if m:
            try:
                found.add(date(int(m[1]), int(m[2]), int(m[3])))
            except ValueError:
                pass
    return found


def plan(
    existing: set[date],
    today: date,
    days: int = 7,
) -> list[date]:
    # Download whatever's missing from the last `days` days (newest included).
    # This auto-resumes and also backfills gaps left by an earlier failed run.
    if not existing:
        print(
            f"INFO: empty output dir; grabbing the last {days} days.",
            file=sys.stderr,
        )
    work: list[date] = []
    d = today - timedelta(days=days - 1)
    while d <= today:
        if d not in existing:
            work.append(d)
        d += timedelta(days=1)
    return work


class OutputLock:
    def __init__(self, out_dir: Path) -> None:
        self.out_dir = out_dir
        self.path = out_dir / ".scraper.lock"
        self._fh = None

    def acquire(self) -> bool:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._fh = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self._fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self._fh.close()
            self._fh = None
            return False
        self._fh.seek(0)
        self._fh.truncate()
        self._fh.write(f"{os.getpid()}\n")
        self._fh.flush()
        return True

    def close(self) -> None:
        if self._fh is None:
            return
        try:
            fcntl.flock(self._fh, fcntl.LOCK_UN)
        finally:
            self._fh.close()
            self._fh = None


def make_scratch_dir(out_dir: Path) -> Path:
    scratch_root = out_dir / ".scratch"
    if scratch_root.is_symlink():
        sys.exit(
            f"ERROR: {scratch_root} is a symlink; remove it manually and rerun."
        )
    scratch_root.mkdir(parents=True, exist_ok=True)
    scratch = scratch_root / f"run-{uuid.uuid4().hex}"
    scratch.mkdir()
    return scratch


def scratch_part_path(scratch: Path, d: date, part_number: int) -> Path:
    return scratch / f"{d.isoformat()}-part{part_number:02d}.mp4"


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


# --- Download + materialize -----------------------------------------------

CHUNK = 1 << 20


async def stream_to_file(
    client: httpx.AsyncClient, part: Part, dest: Path
) -> Path:
    tmp = dest.with_suffix(dest.suffix + ".partial")
    hdrs = {**BROWSER_HEADERS, **part.headers}
    try:
        async with client.stream("GET", part.url, headers=hdrs, timeout=None) as r:
            r.raise_for_status()
            with tmp.open("wb") as f:
                async for chunk in r.aiter_bytes(CHUNK):
                    f.write(chunk)
        tmp.replace(dest)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return dest


def promote_to_output(src: Path, out: Path) -> None:
    tmp = out.with_suffix(out.suffix + ".partial")
    tmp.unlink(missing_ok=True)
    try:
        src.replace(tmp)
        tmp.replace(out)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _stderr_tail(stderr: bytes | str | None, lines: int = 12) -> str:
    if stderr is None:
        return ""
    if isinstance(stderr, bytes):
        text = stderr.decode("utf-8", "replace")
    else:
        text = stderr
    useful = [line for line in text.splitlines() if line.strip()]
    return "\n".join(useful[-lines:])


def _ffmpeg_run(cmd: list[str], out: Path) -> None:
    """Run ffmpeg writing to <out>.partial, rename only on success."""
    tmp = out.with_suffix(out.suffix + ".partial")
    tmp.unlink(missing_ok=True)
    try:
        subprocess.run(
            [*cmd, str(tmp)], check=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        tmp.replace(out)
    except subprocess.CalledProcessError as e:
        tmp.unlink(missing_ok=True)
        tail = _stderr_tail(e.stderr)
        detail = f"\n{tail}" if tail else ""
        raise RuntimeError(
            f"ffmpeg failed with exit code {e.returncode}.{detail}"
        ) from e
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def ffmpeg_concat(parts: list[Path], out: Path) -> None:
    listfile = parts[0].parent / "concat.txt"
    listfile.write_text(
        "\n".join(f"file '{part.resolve()}'" for part in parts) + "\n"
    )
    try:
        _ffmpeg_run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
             "-i", str(listfile), "-c", "copy", "-f", "mp4"],
            out,
        )
    finally:
        listfile.unlink(missing_ok=True)


def ffmpeg_hls(part: Part, out: Path) -> None:
    cmd = ["ffmpeg", "-y"]
    if part.headers:
        cmd += [
            "-headers",
            "".join(f"{k}: {v}\r\n" for k, v in part.headers.items()),
        ]
    cmd += ["-i", part.url, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-f", "mp4"]
    _ffmpeg_run(cmd, out)


async def process_episode(
    client: httpx.AsyncClient,
    show: dict,
    d: date,
    out_dir: Path,
    scratch: Path,
) -> tuple[bool, str]:
    src = await resolve(client, show, d)
    if src is None:
        return False, "no backend"
    out = out_dir / f"{show['title']} - {d.isoformat()}.mp4"

    if src.kind == "hls":
        ffmpeg_hls(src.parts[0], out)
        return True, f"{src.backend}/{src.quality}"

    downloaded: list[Path] = []
    try:
        for i, p in enumerate(src.parts, 1):
            downloaded.append(
                await stream_to_file(client, p, scratch_part_path(scratch, d, i))
            )
        if len(downloaded) == 1:
            promote_to_output(downloaded[0], out)
        else:
            ffmpeg_concat(downloaded, out)
    finally:
        for p in downloaded:
            p.unlink(missing_ok=True)
    return True, f"{src.backend}/{src.quality}"


# --- Main -----------------------------------------------------------------

def positive_int(raw: str) -> int:
    try:
        value = int(raw)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a positive integer") from None
    if value < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return value


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Daily-soap multi-backend downloader.",
    )
    ap.add_argument(
        "--show", default="anupama", choices=list(SHOWS),
        help="Show to fetch (default: anupama).",
    )
    ap.add_argument(
        "--out", type=Path, default=Path.cwd(),
        help="Output directory (default: cwd).",
    )
    ap.add_argument(
        "--days", type=positive_int, default=7, metavar="N",
        help="How many recent days to keep filled (default: 7).",
    )
    ap.add_argument(
        "--probe", type=date.fromisoformat, metavar="YYYY-MM-DD",
        help="Run every backend against one date; no download.",
    )
    return ap


def parse_args() -> argparse.Namespace:
    return build_parser().parse_args()


async def _main(args: argparse.Namespace) -> int:
    show = SHOWS[args.show]
    out_dir = args.out.resolve()

    if args.probe:
        async with httpx.AsyncClient(
            headers=BROWSER_HEADERS, timeout=30, follow_redirects=True,
        ) as client:
            await probe(client, show, args.probe)
        return 0

    lock = OutputLock(out_dir)
    if not lock.acquire():
        print(
            f"Another scraper run is already running for {out_dir}; exiting.",
            file=sys.stderr,
        )
        return 0

    scratch: Path | None = None
    try:
        if shutil.which("ffmpeg") is None:
            sys.exit("ERROR: ffmpeg not on PATH.")

        scratch = make_scratch_dir(out_dir)

        existing = scan_dates(out_dir, show["title"])
        print(
            f"Show: {show['title']} | output dir: {out_dir}",
            file=sys.stderr,
        )
        print(f"  {len(existing)} episodes already on disk.", file=sys.stderr)

        worklist = plan(existing, date.today(), args.days)
        if not worklist:
            print("Nothing to do.", file=sys.stderr)
            return 0

        print(f"Worklist: {len(worklist)} dates", file=sys.stderr)
        for d in worklist:
            print(f"  {d.isoformat()}", file=sys.stderr)

        ok = 0
        failed: list[tuple[date, str]] = []
        async with httpx.AsyncClient(
            headers=BROWSER_HEADERS, timeout=30, follow_redirects=True,
        ) as client:
            for d in worklist:
                print(f"\n=== {d.isoformat()} ===", file=sys.stderr)
                try:
                    success, msg = await process_episode(
                        client, show, d, out_dir, scratch,
                    )
                except Exception as e:                      # noqa: BLE001
                    success, msg = False, f"crash: {e!s}"
                if success:
                    ok += 1
                    print(f"  OK [{msg}]", file=sys.stderr)
                else:
                    failed.append((d, msg))
                    print(f"  FAIL: {msg}", file=sys.stderr)

        print(
            f"\nDone. {ok} downloaded, {len(failed)} failed.",
            file=sys.stderr,
        )
        for d, m in failed:
            print(f"  FAIL {d.isoformat()}: {m}", file=sys.stderr)
        return 1 if failed else 0
    finally:
        if scratch is not None:
            shutil.rmtree(scratch, ignore_errors=True)
        lock.close()


def main() -> int:
    return asyncio.run(_main(parse_args()))


if __name__ == "__main__":
    sys.exit(main())
