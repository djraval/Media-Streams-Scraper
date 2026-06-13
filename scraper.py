# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""daily-soap-scraper - download daily Hindi-serial episodes.

Walks several public mirror sites (hubref.com -> desitvbox.cfd -> yodesi.net)
and downloads each missing episode for a given show. Output files land in the
current directory as `{Title} - YYYY-MM-DD.mp4`.

Discovery is filesystem-based: scan the output dir for already-downloaded
files, find the most recent date, walk forward to today. No external state.

Add a show:    append a dict entry to SHOWS.
Add a backend: write `async fn(client, show, date) -> Source | None` and
               append it to BACKENDS. First non-None wins.

Usage:
  uv run scraper.py [--show NAME] [--out PATH] [--days N] [--probe YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Awaitable, Callable

import httpx


# --- Constants -------------------------------------------------------------

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
BROWSER_HEADERS = {"User-Agent": UA}

MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]


def english_ord(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1:'st',2:'nd',3:'rd'}.get(n % 10, 'th') }"


# --- Data model ------------------------------------------------------------

@dataclass
class Part:
    name: str
    url: str
    size: int = 0
    headers: dict = field(default_factory=dict)


@dataclass
class Source:
    parts: list[Part]
    kind: str           # "mp4" | "hls"
    quality: str        # "720p" | "360p" | "unknown"
    backend: str


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


# --- Dean Edwards p,a,c,k,e,d unpacker (used by desitvbox + yodesi) --------

_PACKED_RE = re.compile(
    r"eval\(function\(p,a,c,k,e,(?:d|r)\).*?\}\s*\(\s*"
    r"'(?P<p>.*?)'\s*,\s*(?P<a>\d+)\s*,\s*(?P<c>\d+)\s*,\s*"
    r"'(?P<k>.*?)'\.split\('\|'\)",
    re.DOTALL,
)


def _packer_encode(n: int, base: int) -> str:
    if n == 0:
        return "0"
    out = ""
    while n:
        r = n % base
        if r < 10:
            ch = chr(48 + r)            # 0-9
        elif r < 36:
            ch = chr(87 + r)            # a-z
        else:
            ch = chr(29 + r)            # A-Z
        out = ch + out
        n //= base
    return out


def unpack(blob: str) -> str:
    m = _PACKED_RE.search(blob)
    if not m:
        return ""
    payload = m.group("p").encode().decode("unicode_escape")
    base = int(m.group("a"))
    count = int(m.group("c"))
    keys = m.group("k").encode().decode("unicode_escape").split("|")
    out = payload
    # Match the original `while(c--)` order: substitute longer tokens first
    # so already-emitted single-char replacements aren't re-matched.
    for i in reversed(range(count)):
        if i < len(keys) and (k := keys[i]):
            tok = _packer_encode(i, base)
            out = re.sub(r"\b" + re.escape(tok) + r"\b", k, out)
    return out


# --- Yandex Disk resolver (used by hubref) --------------------------------

YADISK_API = "https://cloud-api.yandex.net/v1/disk/public/resources"
YADISK_DL = "https://cloud-api.yandex.net/v1/disk/public/resources/download"
YADISK_RE = re.compile(
    r'"publicKey":"(https://(?:yadi\.sk|disk\.yandex\.com)/[^"]+)"'
)


async def yadisk_resolve(client: httpx.AsyncClient, public_key: str) -> Part | None:
    try:
        info_r, dl_r = await asyncio.gather(
            client.get(YADISK_API, params={"public_key": public_key}),
            client.get(YADISK_DL, params={"public_key": public_key}),
        )
        info = info_r.json()
        dl = dl_r.json().get("href")
    except (httpx.HTTPError, ValueError):
        return None
    if not dl or "name" not in info:
        return None
    return Part(name=info["name"], url=dl, size=info.get("size", 0))


# --- Backend 1: hubref.com (720p, 3 parts, MP4) ---------------------------

HUBREF_PLAYER = "https://dstvdisk.showdetails.org/hls/jwplayer.php"
HUBREF_REFERER = "https://blog.showdetails.org/"
_HUBREF_SEM: asyncio.Semaphore | None = None


def _hubref_sem() -> asyncio.Semaphore:
    global _HUBREF_SEM
    if _HUBREF_SEM is None:
        _HUBREF_SEM = asyncio.Semaphore(5)
    return _HUBREF_SEM


def _unescape_qs(raw: str) -> dict[str, str]:
    raw = raw.replace("&#038;", "&").replace("&amp;", "&")
    out = {}
    for pair in raw.split("&"):
        if "=" in pair:
            k, v = pair.split("=", 1)
            out[k] = v
    return out


async def _hubref_yadisk_key(client: httpx.AsyncClient, enc: str) -> str | None:
    async with _hubref_sem():
        try:
            r = await client.get(
                HUBREF_PLAYER, params={"v": enc},
                headers={**BROWSER_HEADERS, "Referer": HUBREF_REFERER},
            )
            r.raise_for_status()
        except httpx.HTTPError:
            return None
    m = YADISK_RE.search(r.text)
    return m.group(1) if m else None


async def hubref_backend(
    client: httpx.AsyncClient, show: dict, d: date
) -> Source | None:
    slug = show["slugs"]["hubref"]
    url = (
        f"https://www.hubref.com/{slug}-{english_ord(d.day)}-"
        f"{MONTHS[d.month-1]}-{d.year}-full-episode-star-plus/"
    )
    try:
        r = await client.get(url, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    m = re.search(r"getlink\.php\?([^\"]+type=jwplayer)", r.text)
    if not m:
        return None
    params = _unescape_qs(m.group(1))
    tokens: list[str] = []
    if "v" in params:
        tokens.append(params["v"])
    for k in sorted(
        (k for k in params if re.match(r"^part\d+$", k)),
        key=lambda k: int(k[4:]),
    ):
        tokens.append(params[k])
    if not tokens:
        return None
    keys = await asyncio.gather(
        *[_hubref_yadisk_key(client, t) for t in tokens],
        return_exceptions=True,
    )
    parts = await asyncio.gather(
        *[yadisk_resolve(client, k) for k in keys if isinstance(k, str) and k],
        return_exceptions=True,
    )
    good = [p for p in parts if isinstance(p, Part)]
    if not good or len(good) < len(tokens):
        return None
    good.sort(key=lambda p: p.name)
    return Source(parts=good, kind="mp4", quality="720p", backend="hubref")


# --- Backend 2: desitvbox.cfd (360p, 1 MP4) -------------------------------

_VK_EMBED_RE = re.compile(r"//vkspeed\.com/embed-([a-z0-9]+)\.html")
_VK_BLOCK_RE = re.compile(r"\{[^{}]*\}")
_VK_FILE_RE = re.compile(
    r'(?:"file"|\bfile)\s*:\s*"(https?://[^"]+\.mp4[^"]*)"'
)
_VK_LABEL_RE = re.compile(
    r'(?:"label"|\blabel)\s*:\s*"(\d+)\s*p?"'
)


async def desitvbox_backend(
    client: httpx.AsyncClient, show: dict, d: date
) -> Source | None:
    slug = show["slugs"]["desitvbox"]
    url = (
        f"https://desitvbox.cfd/{slug}-{english_ord(d.day)}-"
        f"{MONTHS[d.month-1]}-{d.year}-video-episode-update-online/"
    )
    try:
        r = await client.get(url, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    em = _VK_EMBED_RE.search(r.text)
    if not em:
        return None
    embed = f"https://vkspeed.com/embed-{em.group(1)}.html"
    try:
        rr = await client.get(
            embed,
            headers={**BROWSER_HEADERS, "Referer": "https://desitvbox.cfd/"},
            follow_redirects=True,
        )
        rr.raise_for_status()
    except httpx.HTTPError:
        return None
    unpacked = unpack(rr.text)
    candidates: list[tuple[str, int]] = []
    for block in _VK_BLOCK_RE.findall(unpacked):
        fm = _VK_FILE_RE.search(block)
        lm = _VK_LABEL_RE.search(block)
        if fm and lm:
            candidates.append((fm.group(1), int(lm.group(1))))
    if not candidates:
        return None
    candidates.sort(key=lambda x: -x[1])
    mp4_url, qual_int = candidates[0]
    return Source(
        parts=[Part(name=f"desitvbox-{slug}-{d.isoformat()}.mp4", url=mp4_url)],
        kind="mp4",
        quality=f"{qual_int}p",
        backend="desitvbox",
    )


# --- Backend 3: yodesi.net (720p HLS) -------------------------------------

_YODESI_PLAYER_RE = re.compile(
    r'href="(https://tvcine\.me/player\.php\?id=\d+)"'
)
_TVCINE_IFRAME_RE = re.compile(
    r"src=['\"]?(https://flow\.tvlogy\.to/player/[A-Za-z0-9_-]+/?)['\"]?"
)
# JuicyCodes concatenates many base64 fragments: Run("X"+"Y"+"Z")
_JUICY_RE = re.compile(r"JuicyCodes\.Run\(((?:\s*\"[^\"]*\"\s*\+?)+)\)")
_JUICY_SEG_RE = re.compile(r'"([^"]*)"')
_HLS_FILE_RE = re.compile(
    r'(?:"file"|"src"|\bfile|\bsrc)\s*:\s*"(https?://[^"]+\.m3u8[^"]*)"'
)


async def _yodesi_try_broker(
    client: httpx.AsyncClient, broker_url: str, page_url: str
) -> Part | None:
    try:
        broker = await client.get(
            broker_url, headers={**BROWSER_HEADERS, "Referer": page_url},
        )
        broker.raise_for_status()
    except httpx.HTTPError:
        return None
    im = _TVCINE_IFRAME_RE.search(broker.text)
    if not im:
        return None
    flow_url = im.group(1)
    try:
        player = await client.get(
            flow_url, headers={**BROWSER_HEADERS, "Referer": broker_url},
        )
        player.raise_for_status()
    except httpx.HTTPError:
        return None
    jm = _JUICY_RE.search(player.text)
    if not jm:
        return None
    blob = "".join(_JUICY_SEG_RE.findall(jm.group(1)))
    try:
        decoded = base64.b64decode(blob + "===").decode("utf-8", "replace")
    except Exception:                                       # noqa: BLE001
        return None
    unpacked = unpack(decoded)
    hm = _HLS_FILE_RE.search(unpacked)
    if not hm:
        return None
    return Part(
        name="",
        url=hm.group(1).replace("\\/", "/"),
        headers={"Referer": flow_url, "User-Agent": UA},
    )


async def yodesi_backend(
    client: httpx.AsyncClient, show: dict, d: date
) -> Source | None:
    slug = show["slugs"]["yodesi"]
    # yodesi uses literal "th" for every day in its slugs
    url = (
        f"https://www.yodesi.net/{slug}-{d.day}th-"
        f"{MONTHS[d.month-1]}-{d.year}-watch-online/"
    )
    try:
        r = await client.get(url, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    brokers = _YODESI_PLAYER_RE.findall(r.text)
    if not brokers:
        return None
    seen: set[str] = set()
    for broker_url in brokers:
        if broker_url in seen:
            continue
        seen.add(broker_url)
        part = await _yodesi_try_broker(client, broker_url, url)
        if part is not None:
            part.name = f"yodesi-{slug}-{d.isoformat()}.mp4"
            return Source(
                # yodesi's master playlist only offers a 720x480 variant.
                parts=[part], kind="hls", quality="480p", backend="yodesi",
            )
    return None


# --- Resolver -------------------------------------------------------------

Backend = Callable[
    [httpx.AsyncClient, dict, date], Awaitable["Source | None"]
]
# 720p sources first, 360p desitvbox last so it's only ever a last resort.
BACKENDS: list[Backend] = [
    hubref_backend, yodesi_backend, desitvbox_backend,
]


async def resolve(
    client: httpx.AsyncClient, show: dict, d: date
) -> Source | None:
    for be in BACKENDS:
        try:
            src = await be(client, show, d)
        except Exception as e:                              # noqa: BLE001
            print(f"  [{d}] {be.__name__} crashed: {e!s}", file=sys.stderr)
            continue
        if src is None:
            continue
        if src.quality != "720p":
            print(
                f"  [{d}] WARN: only {src.quality} available "
                f"({src.backend}).",
                file=sys.stderr,
            )
        return src
    return None


# --- Discovery ------------------------------------------------------------

def scan_dates(out_dir: Path, title: str) -> set[date]:
    if not out_dir.is_dir():
        return set()
    pat = re.compile(
        re.escape(title) + r" - (\d{4})-(\d{2})-(\d{2})\.mp4$",
        re.IGNORECASE,
    )
    found: set[date] = set()
    for f in out_dir.iterdir():
        m = pat.search(f.name)
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


def _ffmpeg_run(cmd: list[str], out: Path) -> None:
    """Run ffmpeg writing to <out>.partial, rename only on success."""
    tmp = out.with_suffix(out.suffix + ".partial")
    tmp.unlink(missing_ok=True)
    try:
        subprocess.run(
            [*cmd, str(tmp)], check=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        tmp.replace(out)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def ffmpeg_concat(parts: list[Path], out: Path) -> None:
    listfile = out.parent / ".concat.txt"
    listfile.write_text(
        "\n".join(f"file '{p.resolve()}'" for p in parts) + "\n"
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
        for p in src.parts:
            downloaded.append(await stream_to_file(client, p, scratch / p.name))
        if len(downloaded) == 1:
            downloaded[0].replace(out)
        else:
            ffmpeg_concat(downloaded, out)
    finally:
        for p in downloaded:
            p.unlink(missing_ok=True)
    return True, f"{src.backend}/{src.quality}"


# --- Probe mode -----------------------------------------------------------

async def probe(client: httpx.AsyncClient, show: dict, d: date) -> None:
    print(
        f"Probing backends for {d.isoformat()} ({show['title']}):",
        file=sys.stderr,
    )
    for be in BACKENDS:
        try:
            src = await be(client, show, d)
        except Exception as e:                              # noqa: BLE001
            print(f"  {be.__name__:<22} crashed: {e!s}", file=sys.stderr)
            continue
        if src is None:
            print(f"  {be.__name__:<22} no source", file=sys.stderr)
            continue
        print(
            f"  {be.__name__:<22} OK "
            f"[{src.quality}/{src.kind}, {len(src.parts)} parts]",
            file=sys.stderr,
        )
        for i, p in enumerate(src.parts, 1):
            print(f"      part {i}: {p.name}", file=sys.stderr)
            print(f"               {p.url[:110]}...", file=sys.stderr)


# --- Main -----------------------------------------------------------------

def parse_args() -> argparse.Namespace:
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
        "--days", type=int, default=7, metavar="N",
        help="How many recent days to keep filled (default: 7).",
    )
    ap.add_argument(
        "--probe", type=date.fromisoformat, metavar="YYYY-MM-DD",
        help="Run every backend against one date; no download.",
    )
    return ap.parse_args()


async def _main(args: argparse.Namespace) -> int:
    show = SHOWS[args.show]
    out_dir = args.out.resolve()
    scratch = out_dir / ".scratch"

    async with httpx.AsyncClient(
        headers=BROWSER_HEADERS, timeout=30, follow_redirects=True,
    ) as client:
        if args.probe:
            await probe(client, show, args.probe)
            return 0

        if shutil.which("ffmpeg") is None:
            sys.exit("ERROR: ffmpeg not on PATH.")

        if scratch.is_symlink():
            sys.exit(
                f"ERROR: {scratch} is a symlink; remove it manually and "
                "rerun."
            )
        if scratch.exists():
            shutil.rmtree(scratch)
        scratch.mkdir(parents=True)

        existing = scan_dates(out_dir, show["title"])
        print(
            f"Show: {show['title']} | output dir: {out_dir}",
            file=sys.stderr,
        )
        print(f"  {len(existing)} episodes already on disk.", file=sys.stderr)

        worklist = plan(existing, date.today(), args.days)
        if not worklist:
            print("Nothing to do.", file=sys.stderr)
            shutil.rmtree(scratch, ignore_errors=True)
            return 0

        print(f"Worklist: {len(worklist)} dates", file=sys.stderr)
        for d in worklist:
            print(f"  {d.isoformat()}", file=sys.stderr)

        out_dir.mkdir(parents=True, exist_ok=True)
        ok = 0
        failed: list[tuple[date, str]] = []
        for d in worklist:
            print(f"\n=== {d.isoformat()} ===", file=sys.stderr)
            try:
                success, msg = await process_episode(
                    client, show, d, out_dir, scratch,
                )
            except Exception as e:                          # noqa: BLE001
                success, msg = False, f"crash: {e!s}"
            if success:
                ok += 1
                print(f"  OK [{msg}]", file=sys.stderr)
            else:
                failed.append((d, msg))
                print(f"  FAIL: {msg}", file=sys.stderr)

        shutil.rmtree(scratch, ignore_errors=True)
        print(
            f"\nDone. {ok} downloaded, {len(failed)} failed.",
            file=sys.stderr,
        )
        for d, m in failed:
            print(f"  FAIL {d.isoformat()}: {m}", file=sys.stderr)
        return 1 if failed else 0


def main() -> int:
    return asyncio.run(_main(parse_args()))


if __name__ == "__main__":
    sys.exit(main())
