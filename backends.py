"""Backend page-fetch and source-resolution pipelines, plus the HTML/player
parsing helpers and the Part/Source data structures they use. One file so the
whole "where do episode URLs come from" story lives in one place."""

from __future__ import annotations

import asyncio
import base64
import html
import inspect
import re
import sys
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from datetime import date
from html.parser import HTMLParser
from typing import Any, TypeAlias
from urllib.parse import parse_qsl, urlsplit

import httpx


# --- Shared data structures ------------------------------------------------

@dataclass
class Part:
    name: str
    url: str
    size: int = 0
    headers: dict = field(default_factory=dict)


@dataclass
class Source:
    parts: list[Part]
    kind: str
    quality: str
    backend: str


ShowConfig: TypeAlias = dict[str, Any]
Backend: TypeAlias = Callable[
    [httpx.AsyncClient, ShowConfig, date], Awaitable[Source | None]
]


def _dedupe(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


# --- HTML / player extraction helpers --------------------------------------

_PACKED_RE = re.compile(
    r"eval\(function\(p,a,c,k,e,(?:d|r)\).*?\}\s*\(\s*"
    r"'(?P<p>.*?)'\s*,\s*(?P<a>\d+)\s*,\s*(?P<c>\d+)\s*,\s*"
    r"'(?P<k>.*?)'\.split\('\|'\)",
    re.DOTALL,
)
_YADISK_URL_RE = re.compile(
    r"https?://(?:yadi\.sk|disk\.yandex\.com)/[^\s'\"<>\\)\]}]+",
    re.IGNORECASE,
)
_JUICY_CALL_RE = re.compile(r"JuicyCodes\.Run\((?P<body>.*?)\)", re.DOTALL)
_STRING_SEG_RE = re.compile(r"(['\"])(.*?)(?<!\\)\1", re.DOTALL)


def decode_text(raw: str) -> str:
    text = html.unescape(raw)
    replacements = {
        r"\/": "/",
        r"\u0026": "&",
        r"\u003d": "=",
        r"\u003f": "?",
        r"\u002f": "/",
        r"\x26": "&",
        r"\x3d": "=",
        r"\x3f": "?",
        r"\x2f": "/",
    }
    for escaped, replacement in replacements.items():
        text = re.sub(re.escape(escaped), replacement, text, flags=re.IGNORECASE)
    return html.unescape(text)


class _AttrParser(HTMLParser):
    def __init__(self, tags: set[str], attrs: set[str]) -> None:
        super().__init__(convert_charrefs=True)
        self.tags = tags
        self.attrs = attrs
        self.values: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() not in self.tags:
            return
        for name, value in attrs:
            if value is not None and name.lower() in self.attrs:
                self.values.append(decode_text(value.strip()))


def attr_values(markup: str, tags: Iterable[str], attrs: Iterable[str]) -> list[str]:
    parser = _AttrParser(
        {tag.lower() for tag in tags},
        {attr.lower() for attr in attrs},
    )
    parser.feed(markup)
    return _dedupe(parser.values)


def links(markup: str) -> list[str]:
    return attr_values(markup, ["a", "link", "area"], ["href"])


def iframes(markup: str) -> list[str]:
    return attr_values(markup, ["iframe"], ["src"])


def embeds(markup: str) -> list[str]:
    return attr_values(
        markup, ["embed", "object", "source", "video"], ["src", "data"]
    )


def _media_candidates(raw: str, extension: str) -> list[str]:
    text = decode_text(raw)
    pattern = re.compile(
        r"https?://[^\s'\"<>\\,}\]]+\."
        + re.escape(extension)
        + r"(?:\?[^\s'\"<>\\}\]]*)?",
        re.IGNORECASE,
    )
    return _dedupe(
        match.group(0).rstrip(".;)")
        for match in pattern.finditer(text)
    )


def mp4_candidates(raw: str) -> list[str]:
    return _media_candidates(raw, "mp4")


def m3u8_candidates(raw: str) -> list[str]:
    return _media_candidates(raw, "m3u8")


def yadisk_public_keys(raw: str) -> list[str]:
    text = decode_text(raw)
    return _dedupe(
        match.group(0).rstrip(".;,)]}")
        for match in _YADISK_URL_RE.finditer(text)
    )


def _packer_encode(n: int, base: int) -> str:
    if n == 0:
        return "0"
    out = ""
    while n:
        r = n % base
        if r < 10:
            ch = chr(48 + r)
        elif r < 36:
            ch = chr(87 + r)
        else:
            ch = chr(29 + r)
        out = ch + out
        n //= base
    return out


def unpack(blob: str) -> str:
    match = _PACKED_RE.search(blob)
    if not match:
        return ""
    payload = match.group("p").encode().decode("unicode_escape")
    base = int(match.group("a"))
    count = int(match.group("c"))
    keys = match.group("k").encode().decode("unicode_escape").split("|")
    out = payload
    for i in reversed(range(count)):
        if i < len(keys) and (key := keys[i]):
            token = _packer_encode(i, base)
            out = re.sub(r"\b" + re.escape(token) + r"\b", key, out)
    return out


def juicycodes_payloads(raw: str) -> list[str]:
    payloads: list[str] = []
    for call in _JUICY_CALL_RE.finditer(raw):
        parts = [segment for _, segment in _STRING_SEG_RE.findall(call.group("body"))]
        if parts:
            payloads.append("".join(parts))
    return _dedupe(payloads)


# --- Backend constants -----------------------------------------------------

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
BROWSER_HEADERS = {"User-Agent": UA}

MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]

YADISK_API = "https://cloud-api.yandex.net/v1/disk/public/resources"
YADISK_DL = "https://cloud-api.yandex.net/v1/disk/public/resources/download"
HUBREF_PLAYER = "https://dstvdisk.showdetails.org/hls/jwplayer.php"
HUBREF_REFERER = "https://blog.showdetails.org/"

_HUBREF_SEM: asyncio.Semaphore | None = None
_GETLINK_RE = re.compile(r"(?:https?://[^\s'\"<>]+)?getlink\.php\?[^\s'\"<>]+", re.I)
_VKSPEED_RE = re.compile(r"(?:(?:https?:)?//)?vkspeed\.com/embed-([A-Za-z0-9]+)\.html", re.I)
_TVCINE_RE = re.compile(r"https?://tvcine\.me/player\.php\?[^\s'\"<>]+", re.I)
_FLOW_RE = re.compile(r"https?://flow\.tvlogy\.to/player/[A-Za-z0-9_-]+/?", re.I)
_QUALITY_RE = re.compile(
    r"(?:label|quality|res|resolution|height)['\"]?\s*[:=]\s*['\"]?(\d{3,4})\s*p?",
    re.I,
)
_RESOLUTION_RE = re.compile(r"\b(\d{3,4})p\b", re.I)


class ProbeLog:
    def __init__(self, backend: str) -> None:
        self.backend = backend
        self.lines: list[str] = []

    def step(self, label: str, detail: str) -> None:
        self.lines.append(f"{self.backend} {label}: {detail}")

    def candidates(self, label: str, values: list[str], limit: int = 5) -> None:
        self.lines.append(f"{self.backend} {label}: {len(values)}")
        for value in values[:limit]:
            self.lines.append(f"{self.backend}   {value}")
        if len(values) > limit:
            self.lines.append(f"{self.backend}   ... {len(values) - limit} more")


def english_ord(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1:'st',2:'nd',3:'rd'}.get(n % 10, 'th') }"


def _hubref_sem() -> asyncio.Semaphore:
    global _HUBREF_SEM
    if _HUBREF_SEM is None:
        _HUBREF_SEM = asyncio.Semaphore(5)
    return _HUBREF_SEM


def _query_params(raw: str) -> dict[str, str]:
    raw = decode_text(raw).replace("&#038;", "&")
    return dict(parse_qsl(raw, keep_blank_values=True))


def _urls_from_markup(markup: str) -> list[str]:
    return _dedupe([
        *links(markup),
        *iframes(markup),
        *embeds(markup),
    ])


def _getlink_queries(markup: str) -> list[str]:
    normalized = decode_text(markup)
    candidates = [
        *_urls_from_markup(markup),
        *[m.group(0) for m in _GETLINK_RE.finditer(normalized)],
    ]
    queries: list[str] = []
    for candidate in _dedupe(candidates):
        if "getlink.php?" not in candidate:
            continue
        parsed = urlsplit(candidate)
        query = parsed.query or candidate.split("getlink.php?", 1)[1]
        if "type=jwplayer" in query:
            queries.append(query)
    return _dedupe(queries)


def _vkspeed_embeds(markup: str) -> list[str]:
    normalized = decode_text(markup)
    candidates = [
        *_urls_from_markup(markup),
        *[m.group(0) for m in _VKSPEED_RE.finditer(normalized)],
    ]
    urls: list[str] = []
    for candidate in candidates:
        match = _VKSPEED_RE.search(candidate)
        if match:
            urls.append(f"https://vkspeed.com/embed-{match.group(1)}.html")
    return _dedupe(urls)


def _broker_candidates(markup: str) -> list[str]:
    normalized = decode_text(markup)
    candidates = [
        *_urls_from_markup(markup),
        *[m.group(0) for m in _TVCINE_RE.finditer(normalized)],
    ]
    return _dedupe(
        [candidate for candidate in candidates if _TVCINE_RE.search(candidate)]
    )


def _flow_candidates(markup: str) -> list[str]:
    normalized = decode_text(markup)
    candidates = [
        *_urls_from_markup(markup),
        *[m.group(0) for m in _FLOW_RE.finditer(normalized)],
    ]
    flows: list[str] = []
    for candidate in candidates:
        match = _FLOW_RE.search(candidate)
        if match:
            flows.append(match.group(0))
    return _dedupe(flows)


def _quality_near_url(normalized_text: str, url: str) -> int | None:
    index = normalized_text.find(url)
    if index == -1:
        return None

    after = normalized_text[index: index + len(url) + 120]
    match = _QUALITY_RE.search(after) or _RESOLUTION_RE.search(after)
    if match:
        return int(match.group(1))

    before = normalized_text[max(0, index - 120): index]
    matches = [*_QUALITY_RE.finditer(before), *_RESOLUTION_RE.finditer(before)]
    return int(matches[-1].group(1)) if matches else None


def _ranked_mp4_candidates(text: str) -> list[tuple[str, int | None]]:
    normalized = decode_text(text)
    ranked = [
        (url, _quality_near_url(normalized, url))
        for url in mp4_candidates(text)
    ]
    ranked.sort(
        key=lambda item: (item[1] is not None, item[1] or 0),
        reverse=True,
    )
    return ranked


def _decode_b64(payload: str) -> str | None:
    try:
        padding = "=" * (-len(payload) % 4)
        return base64.b64decode(payload + padding).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None


async def yadisk_resolve(client: httpx.AsyncClient, public_key: str) -> Part | None:
    try:
        info_r, dl_r = await asyncio.gather(
            client.get(YADISK_API, params={"public_key": public_key}),
            client.get(YADISK_DL, params={"public_key": public_key}),
        )
        info = info_r.json()
        download_url = dl_r.json().get("href")
    except (httpx.HTTPError, ValueError):
        return None
    if not download_url or "name" not in info:
        return None
    return Part(name=info["name"], url=download_url, size=info.get("size", 0))


async def _hubref_yadisk_key(client: httpx.AsyncClient, token: str) -> str | None:
    async with _hubref_sem():
        try:
            response = await client.get(
                HUBREF_PLAYER,
                params={"v": token},
                headers={**BROWSER_HEADERS, "Referer": HUBREF_REFERER},
            )
            response.raise_for_status()
        except httpx.HTTPError:
            return None
    keys = yadisk_public_keys(response.text)
    return keys[0] if keys else None


async def hubref_backend(
    client: httpx.AsyncClient,
    show: ShowConfig,
    d: date,
    trace: ProbeLog | None = None,
) -> Source | None:
    slug = show["slugs"]["hubref"]
    url = (
        f"https://www.hubref.com/{slug}-{english_ord(d.day)}-"
        f"{MONTHS[d.month-1]}-{d.year}-full-episode-star-plus/"
    )
    try:
        response = await client.get(url, follow_redirects=True)
    except httpx.HTTPError as exc:
        if trace:
            trace.step("page", f"GET {url} failed: {exc!s}")
        return None
    if trace:
        trace.step("page", f"GET {url} -> {response.status_code}")
    if response.status_code != 200:
        return None

    queries = _getlink_queries(response.text)
    if trace:
        trace.candidates(
            "getlink candidates", [f"getlink.php?{query}" for query in queries]
        )
    if not queries:
        return None

    params = _query_params(queries[0])
    tokens: list[str] = []
    if "v" in params:
        tokens.append(params["v"])
    for key in sorted(
        (key for key in params if re.match(r"^part\d+$", key)),
        key=lambda value: int(value[4:]),
    ):
        tokens.append(params[key])
    if trace:
        trace.candidates("jwplayer tokens", tokens)
    if not tokens:
        return None

    keys = await asyncio.gather(
        *[_hubref_yadisk_key(client, token) for token in tokens],
        return_exceptions=True,
    )
    public_keys = [key for key in keys if isinstance(key, str) and key]
    if trace:
        trace.candidates("yadisk public keys", public_keys)

    parts = await asyncio.gather(
        *[yadisk_resolve(client, key) for key in public_keys],
        return_exceptions=True,
    )
    good = [part for part in parts if isinstance(part, Part)]
    if trace:
        trace.step("resolved parts", f"{len(good)}/{len(tokens)}")
    if not good or len(good) < len(tokens):
        return None
    good.sort(key=lambda part: part.name)
    return Source(parts=good, kind="mp4", quality="720p", backend="hubref")


async def desitvbox_backend(
    client: httpx.AsyncClient,
    show: ShowConfig,
    d: date,
    trace: ProbeLog | None = None,
) -> Source | None:
    slug = show["slugs"]["desitvbox"]
    url = (
        f"https://desitvbox.cfd/{slug}-{english_ord(d.day)}-"
        f"{MONTHS[d.month-1]}-{d.year}-video-episode-update-online/"
    )
    try:
        response = await client.get(url, follow_redirects=True)
    except httpx.HTTPError as exc:
        if trace:
            trace.step("page", f"GET {url} failed: {exc!s}")
        return None
    if trace:
        trace.step("page", f"GET {url} -> {response.status_code}")
    if response.status_code != 200:
        return None

    embeds = _vkspeed_embeds(response.text)
    if trace:
        trace.candidates("embed candidates", embeds)
    for embed_url in embeds:
        try:
            player = await client.get(
                embed_url,
                headers={**BROWSER_HEADERS, "Referer": "https://desitvbox.cfd/"},
                follow_redirects=True,
            )
            player.raise_for_status()
        except httpx.HTTPError as exc:
            if trace:
                trace.step("embed page", f"GET {embed_url} failed: {exc!s}")
            continue
        if trace:
            trace.step("embed page", f"GET {embed_url} -> {player.status_code}")

        unpacked = unpack(player.text)
        texts = [player.text]
        if unpacked:
            texts.append(unpacked)
        ranked = _ranked_mp4_candidates("\n".join(texts))
        if trace:
            trace.candidates("mp4 candidates", [url for url, _ in ranked])
        if not ranked:
            continue

        mp4_url, quality_int = ranked[0]
        quality = f"{quality_int}p" if quality_int else "unknown"
        return Source(
            parts=[Part(name=f"desitvbox-{slug}-{d.isoformat()}.mp4", url=mp4_url)],
            kind="mp4",
            quality=quality,
            backend="desitvbox",
        )
    return None


async def _yodesi_try_broker(
    client: httpx.AsyncClient,
    broker_url: str,
    page_url: str,
    trace: ProbeLog | None = None,
) -> Part | None:
    try:
        broker = await client.get(
            broker_url, headers={**BROWSER_HEADERS, "Referer": page_url},
        )
        broker.raise_for_status()
    except httpx.HTTPError as exc:
        if trace:
            trace.step("broker", f"GET {broker_url} failed: {exc!s}")
        return None
    if trace:
        trace.step("broker", f"GET {broker_url} -> {broker.status_code}")

    flows = _flow_candidates(broker.text)
    if trace:
        trace.candidates("flow iframe candidates", flows)
    for flow_url in flows:
        try:
            player = await client.get(
                flow_url, headers={**BROWSER_HEADERS, "Referer": broker_url},
            )
            player.raise_for_status()
        except httpx.HTTPError as exc:
            if trace:
                trace.step("flow player", f"GET {flow_url} failed: {exc!s}")
            continue
        if trace:
            trace.step("flow player", f"GET {flow_url} -> {player.status_code}")

        texts = [player.text]
        payloads = juicycodes_payloads(player.text)
        if trace:
            trace.step("juicy payloads", str(len(payloads)))
        for payload in payloads:
            decoded = _decode_b64(payload)
            if decoded:
                texts.append(decoded)
                unpacked = unpack(decoded)
                if unpacked:
                    texts.append(unpacked)
        hls_urls = m3u8_candidates("\n".join(texts))
        if trace:
            trace.candidates("m3u8 candidates", hls_urls)
        if hls_urls:
            return Part(
                name="",
                url=hls_urls[0],
                headers={"Referer": flow_url, "User-Agent": UA},
            )
    return None


async def yodesi_backend(
    client: httpx.AsyncClient,
    show: ShowConfig,
    d: date,
    trace: ProbeLog | None = None,
) -> Source | None:
    slug = show["slugs"]["yodesi"]
    url = (
        f"https://www.yodesi.net/{slug}-{d.day}th-"
        f"{MONTHS[d.month-1]}-{d.year}-watch-online/"
    )
    try:
        response = await client.get(url, follow_redirects=True)
    except httpx.HTTPError as exc:
        if trace:
            trace.step("page", f"GET {url} failed: {exc!s}")
        return None
    if trace:
        trace.step("page", f"GET {url} -> {response.status_code}")
    if response.status_code != 200:
        return None

    brokers = _broker_candidates(response.text)
    if trace:
        trace.candidates("broker candidates", brokers)
    for broker_url in brokers:
        part = await _yodesi_try_broker(client, broker_url, url, trace)
        if part is not None:
            part.name = f"yodesi-{slug}-{d.isoformat()}.mp4"
            return Source(
                parts=[part],
                kind="hls",
                quality="480p",
                backend="yodesi",
            )
    return None


BACKENDS = [hubref_backend, yodesi_backend, desitvbox_backend]


def _trace_mode(backend) -> str:
    try:
        params = list(inspect.signature(backend).parameters.values())
    except (TypeError, ValueError):
        return "positional"

    if any(param.kind is inspect.Parameter.VAR_KEYWORD for param in params):
        return "keyword"
    if any(param.name == "trace" for param in params):
        return "keyword"
    if any(param.kind is inspect.Parameter.VAR_POSITIONAL for param in params):
        return "positional"

    positional = [
        param for param in params
        if param.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    ]
    return "positional" if len(positional) >= 4 else "none"


async def _call_probe_backend(
    backend,
    client: httpx.AsyncClient,
    show: ShowConfig,
    d: date,
    trace: ProbeLog,
) -> Source | None:
    mode = _trace_mode(backend)
    if mode == "keyword":
        return await backend(client, show, d, trace=trace)
    if mode == "positional":
        return await backend(client, show, d, trace)
    return await backend(client, show, d)


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


async def probe(client: httpx.AsyncClient, show: ShowConfig, d: date) -> None:
    print(
        f"Probing backends for {d.isoformat()} ({show['title']}):",
        file=sys.stderr,
    )
    for backend in BACKENDS:
        trace = ProbeLog(backend.__name__.removesuffix("_backend"))
        try:
            src = await _call_probe_backend(backend, client, show, d, trace)
        except Exception as exc:  # noqa: BLE001
            print(f"  {backend.__name__:<22} crashed: {exc!s}", file=sys.stderr)
            for line in trace.lines:
                print(f"      {line}", file=sys.stderr)
            continue
        if src is None:
            print(f"  {backend.__name__:<22} no source", file=sys.stderr)
        else:
            print(
                f"  {backend.__name__:<22} OK "
                f"[{src.quality}/{src.kind}, {len(src.parts)} parts]",
                file=sys.stderr,
            )
            for i, part in enumerate(src.parts, 1):
                print(f"      part {i}: {part.name}", file=sys.stderr)
                print(f"               {part.url[:110]}...", file=sys.stderr)
        for line in trace.lines:
            print(f"      {line}", file=sys.stderr)
