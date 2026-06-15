import argparse
import asyncio
import io
import subprocess
import tempfile
import unittest
from base64 import b64encode
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import backends
import scraper


class FakeResponse:
    def __init__(self, text="", status_code=200, json_data=None):
        self.text = text
        self.status_code = status_code
        self._json_data = json_data

    def json(self):
        if self._json_data is None:
            raise ValueError("no json")
        return self._json_data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeClient:
    def __init__(self, routes):
        self.routes = routes

    async def get(self, url, **kwargs):
        key = url
        params = kwargs.get("params")
        if params:
            key = (url, tuple(sorted(params.items())))
        response = self.routes[key]
        return response() if callable(response) else response


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

    def test_clears_stale_files_before_downloading(self):
        with tempfile.TemporaryDirectory() as tmp:
            scratch = Path(tmp)
            stem = scratch / "2026-06-14-part01"
            # Simulate leftovers from a previous failed attempt on the same stem:
            (scratch / "2026-06-14-part01.mp4").write_bytes(b"STALE")
            (scratch / "2026-06-14-part01.mp4.part").write_bytes(b"partial")

            saw_before = {}

            class FakeYDL:
                def __init__(self, opts): pass
                def __enter__(self): return self
                def __exit__(self, *a): return False
                def download(self, urls):
                    # capture what files exist at download time (post-cleanup)
                    saw_before["files"] = sorted(
                        p.name for p in stem.parent.glob(stem.name + ".*")
                    )
                    (stem.parent / (stem.name + ".mp4")).write_bytes(b"FRESH")
                    return 0

            part = scraper.Part(name="p1", url="https://cdn/x.mp4")
            with patch.object(scraper.yt_dlp, "YoutubeDL", FakeYDL):
                produced = scraper.ydl_download(part, stem)
            # stale files were cleared BEFORE yt-dlp ran
            self.assertEqual(saw_before["files"], [])
            # result is the fresh download, not the stale leftover
            self.assertEqual(produced.read_bytes(), b"FRESH")


class BackendHelperTests(unittest.TestCase):
    def test_iframe_embed_and_link_discovery_tolerates_attribute_variants(self):
        html = """
        <a data-kind='watch' href='getlink.php?part1=a&amp;type=jwplayer'>Watch</a>
        <iframe allowfullscreen SRC='//vkspeed.com/embed-ab12.html'></iframe>
        <embed data-x="1" src=https://flow.tvlogy.to/player/AbC_9/>
        """

        self.assertEqual(
            backends.links(html),
            ["getlink.php?part1=a&type=jwplayer"],
        )
        self.assertEqual(
            backends.iframes(html),
            ["//vkspeed.com/embed-ab12.html"],
        )
        self.assertEqual(
            backends.embeds(html),
            ["https://flow.tvlogy.to/player/AbC_9/"],
        )

    def test_media_candidates_unescape_slashes_and_keep_query_strings(self):
        text = (
            "file: 'https:\\/\\/cdn.example.test\\/video.mp4?token=a\\u0026q=720',"
            '"src":"https:\\/\\/hls.example.test\\/master.m3u8?sig=x&amp;v=1"'
        )

        self.assertEqual(
            backends.mp4_candidates(text),
            ["https://cdn.example.test/video.mp4?token=a&q=720"],
        )
        self.assertEqual(
            backends.m3u8_candidates(text),
            ["https://hls.example.test/master.m3u8?sig=x&v=1"],
        )

    def test_yadisk_public_key_extraction_handles_nested_script_shapes(self):
        text = (
            "<script>window.__data={items:[{disk:{publicKey:"
            "'https:\\/\\/disk.yandex.com\\/i\\/abc123?download=1'}}]};</script>"
        )

        self.assertEqual(
            backends.yadisk_public_keys(text),
            ["https://disk.yandex.com/i/abc123?download=1"],
        )

    def test_packed_javascript_unpacking_decodes_words(self):
        packed = (
            "eval(function(p,a,c,k,e,d){return p;}"
            "('0(\"1\")',2,2,'alert|ready'.split('|'),0,{}))"
        )

        self.assertEqual(backends.unpack(packed), 'alert("ready")')


class BackendMarkupTests(unittest.TestCase):
    def test_hubref_uses_broad_getlink_and_yadisk_key_discovery(self):
        d = date(2026, 6, 14)
        show = scraper.SHOWS["anupama"]
        page_url = (
            "https://www.hubref.com/anupama-14th-june-2026-full-episode-star-plus/"
        )
        player = "https://dstvdisk.showdetails.org/hls/jwplayer.php"
        keys = {
            "enc-main": "https://disk.yandex.com/i/main",
            "enc-one": "https://disk.yandex.com/i/one",
            "enc-two": "https://disk.yandex.com/i/two",
        }
        routes = {
            page_url: FakeResponse(
                "<a data-id='watch' href='getlink.php?type=jwplayer"
                "&amp;part2=enc-two&amp;v=enc-main&amp;part1=enc-one'>go</a>"
            )
        }
        for token, public_key in keys.items():
            routes[(player, (("v", token),))] = FakeResponse(
                "window.payload={items:[{publicKey:'"
                + public_key.replace("/", "\\/")
                + "'}]};"
            )
            routes[
                (
                    backends.YADISK_API,
                    (("public_key", public_key),),
                )
            ] = FakeResponse(json_data={"name": f"{token}.mp4", "size": 100})
            routes[
                (
                    backends.YADISK_DL,
                    (("public_key", public_key),),
                )
            ] = FakeResponse(json_data={"href": f"https://download/{token}.mp4"})

        src = asyncio.run(backends.hubref_backend(FakeClient(routes), show, d))

        self.assertIsNotNone(src)
        self.assertEqual(src.backend, "hubref")
        self.assertEqual([p.url for p in src.parts], [
            "https://download/enc-main.mp4",
            "https://download/enc-one.mp4",
            "https://download/enc-two.mp4",
        ])

    def test_desitvbox_accepts_https_embed_and_single_quoted_player_sources(self):
        d = date(2026, 6, 14)
        show = scraper.SHOWS["anupama"]
        page_url = (
            "https://desitvbox.cfd/anupama-14th-june-2026-video-episode-update-online/"
        )
        routes = {
            page_url: FakeResponse(
                "<iframe data-source='vk' src='https://vkspeed.com/embed-ab12.html'>"
                "</iframe>"
            ),
            "https://vkspeed.com/embed-ab12.html": FakeResponse(
                "player.setup({sources:[{file:'https:\\/\\/cdn.test\\/low.mp4?x=1',"
                "label:'360p'},{file:'https:\\/\\/cdn.test\\/hi.mp4?x=2',"
                "label:'720p'}]});"
            ),
        }

        src = asyncio.run(backends.desitvbox_backend(FakeClient(routes), show, d))

        self.assertIsNotNone(src)
        self.assertEqual(src.backend, "desitvbox")
        self.assertEqual(src.quality, "720p")
        self.assertEqual(src.parts[0].url, "https://cdn.test/hi.mp4?x=2")

    def test_yodesi_accepts_single_quoted_broker_and_juicycodes_payload(self):
        d = date(2026, 6, 14)
        show = scraper.SHOWS["anupama"]
        page_url = "https://www.yodesi.net/anupamaa-14th-june-2026-watch-online/"
        broker_url = "https://tvcine.me/player.php?id=42&server=1"
        flow_url = "https://flow.tvlogy.to/player/AbC_9/"
        decoded = (
            "player.setup({sources:[{src:'https:\\/\\/hls.test\\/master.m3u8"
            "?token=1\\u0026sig=2'}]});"
        )
        payload = b64encode(decoded.encode()).decode()
        routes = {
            page_url: FakeResponse(
                f"<a data-player='primary' href='{broker_url}'>watch</a>"
            ),
            broker_url: FakeResponse(
                f"<iframe loading='lazy' src='{flow_url}'></iframe>"
            ),
            flow_url: FakeResponse(f"JuicyCodes.Run('{payload}')"),
        }

        src = asyncio.run(backends.yodesi_backend(FakeClient(routes), show, d))

        self.assertIsNotNone(src)
        self.assertEqual(src.backend, "yodesi")
        self.assertEqual(src.kind, "hls")
        self.assertEqual(
            src.parts[0].url,
            "https://hls.test/master.m3u8?token=1&sig=2",
        )
        self.assertEqual(src.parts[0].headers["Referer"], flow_url)

    def test_probe_reports_backend_steps_and_candidate_urls(self):
        d = date(2026, 6, 14)
        show = scraper.SHOWS["anupama"]
        page_url = (
            "https://desitvbox.cfd/anupama-14th-june-2026-video-episode-update-online/"
        )
        routes = {
            page_url: FakeResponse(
                "<iframe src='https://vkspeed.com/embed-ab12.html'></iframe>"
            ),
            "https://vkspeed.com/embed-ab12.html": FakeResponse(
                "sources:[{file:'https:\\/\\/cdn.test\\/episode.mp4?x=1',"
                "label:'360p'}]"
            ),
        }
        stderr = io.StringIO()

        with patch.object(backends, "BACKENDS", [backends.desitvbox_backend]):
            with patch("sys.stderr", stderr):
                asyncio.run(backends.probe(FakeClient(routes), show, d))

        output = stderr.getvalue()
        self.assertIn("desitvbox page: GET", output)
        self.assertIn("desitvbox embed candidates: 1", output)
        self.assertIn("https://vkspeed.com/embed-ab12.html", output)
        self.assertIn("desitvbox mp4 candidates: 1", output)
        self.assertIn("https://cdn.test/episode.mp4?x=1", output)

    def test_probe_accepts_documented_three_argument_backend_signature(self):
        async def legacy_backend(client, show, d):
            return scraper.Source(
                parts=[scraper.Part(name="legacy.mp4", url="https://cdn.test/legacy.mp4")],
                kind="mp4",
                quality="720p",
                backend="legacy",
            )

        stderr = io.StringIO()
        with patch.object(backends, "BACKENDS", [legacy_backend]):
            with patch("sys.stderr", stderr):
                asyncio.run(
                    backends.probe(FakeClient({}), scraper.SHOWS["anupama"], date(2026, 6, 14))
                )

        self.assertIn("legacy_backend", stderr.getvalue())
        self.assertIn("OK [720p/mp4, 1 parts]", stderr.getvalue())


class ProbeModeTests(unittest.TestCase):
    def test_main_probe_path_uses_mocked_probe_without_locking_or_ffmpeg(self):
        seen = []

        async def fake_probe(client, show, d):
            seen.append((client, show["title"], d))

        class FakeAsyncClient:
            def __init__(self, **kwargs):
                self.kwargs = kwargs

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

        args = argparse.Namespace(
            show="anupama",
            out=Path("/tmp/not-used"),
            days=7,
            probe=date(2026, 6, 14),
        )

        with (
            patch.object(scraper, "probe", fake_probe),
            patch.object(scraper.httpx, "AsyncClient", FakeAsyncClient),
            patch.object(scraper.shutil, "which", side_effect=AssertionError),
            patch.object(scraper.OutputLock, "acquire", side_effect=AssertionError),
        ):
            code = asyncio.run(scraper._main(args))

        self.assertEqual(code, 0)
        self.assertEqual(seen[0][1:], ("Anupamaa", date(2026, 6, 14)))


class PlanTests(unittest.TestCase):
    def test_empty_folder_plans_last_seven_days(self):
        today = date(2026, 6, 14)

        with patch("sys.stderr", io.StringIO()):
            work = scraper.plan(set(), today, days=7)

        self.assertEqual(
            work,
            [today - timedelta(days=offset) for offset in reversed(range(7))],
        )

    def test_existing_recent_files_backfills_missing_older_days(self):
        today = date(2026, 6, 14)
        existing = {today - timedelta(days=offset) for offset in range(5)}

        work = scraper.plan(existing, today, days=14)

        self.assertEqual(
            work,
            [date(2026, 6, day) for day in range(1, 10)],
        )

    def test_gaps_inside_window_are_retried(self):
        today = date(2026, 6, 14)
        window = {today - timedelta(days=offset) for offset in range(7)}
        missing = date(2026, 6, 11)
        window.remove(missing)

        self.assertEqual(scraper.plan(window, today, days=7), [missing])

    def test_invalid_days_is_rejected_by_argparse_before_planning(self):
        parser = scraper.build_parser()

        for raw in ("0", "-3", "abc"):
            with self.subTest(raw=raw):
                with patch("sys.stderr", io.StringIO()):
                    with self.assertRaises(SystemExit) as cm:
                        parser.parse_args(["--days", raw])

                self.assertEqual(cm.exception.code, 2)


class ScanDatesTests(unittest.TestCase):
    def test_scan_dates_matches_exact_episode_filenames(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "Anupamaa - 2026-06-14.mp4").touch()
            (out / "anupamaa - 2026-06-13.mp4").touch()
            (out / "prefix Anupamaa - 2026-06-12.mp4").touch()
            (out / "Anupamaa - 2026-06-11.mp4.partial").touch()
            (out / "Other Show - 2026-06-10.mp4").touch()

            self.assertEqual(
                scraper.scan_dates(out, "Anupamaa"),
                {date(2026, 6, 14), date(2026, 6, 13)},
            )

    def test_scan_dates_ignores_malformed_dates(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "Anupamaa - 2026-02-30.mp4").touch()
            (out / "Anupamaa - 2026-06-14.mp4").touch()

            self.assertEqual(
                scraper.scan_dates(out, "Anupamaa"),
                {date(2026, 6, 14)},
            )


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


class FfmpegTests(unittest.TestCase):
    def test_ffmpeg_failure_reports_tail_of_stderr(self):
        stderr = "\n".join(f"line {i}" for i in range(1, 9)).encode()

        def fake_run(*args, **kwargs):
            raise subprocess.CalledProcessError(
                returncode=1,
                cmd=args[0],
                stderr=stderr,
            )

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "episode.mp4"
            with patch.object(subprocess, "run", fake_run):
                with self.assertRaisesRegex(RuntimeError, "line 8"):
                    scraper._ffmpeg_run(["ffmpeg", "-y"], out)


class RunSafetyTests(unittest.TestCase):
    def test_active_output_lock_exits_zero_before_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            lock = scraper.OutputLock(out_dir)
            self.assertTrue(lock.acquire())
            stderr = io.StringIO()

            args = argparse.Namespace(
                show="anupama",
                out=out_dir,
                days=7,
                probe=None,
            )
            with (
                patch.object(scraper.shutil, "which", return_value="/usr/bin/ffmpeg"),
                patch("sys.stderr", stderr),
            ):
                code = asyncio.run(scraper._main(args))

            lock.close()

        self.assertEqual(code, 0)
        self.assertIn("already running", stderr.getvalue())

    def test_download_uses_run_scratch_and_cleans_it(self):
        async def fake_process_episode(client, show, d, out_dir, scratch):
            seen_scratch.append(scratch)
            (scratch / "leftover.tmp").write_text("x")
            return True, "fake"

        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            seen_scratch = []
            args = argparse.Namespace(
                show="anupama",
                out=out_dir,
                days=7,
                probe=None,
            )
            with (
                patch.object(scraper.shutil, "which", return_value="/usr/bin/ffmpeg"),
                patch.object(scraper, "scan_dates", return_value=set()),
                patch.object(scraper, "plan", return_value=[date(2026, 6, 14)]),
                patch.object(scraper, "process_episode", fake_process_episode),
                patch("sys.stderr", io.StringIO()),
            ):
                code = asyncio.run(scraper._main(args))

            self.assertEqual(code, 0)
            self.assertEqual(len(seen_scratch), 1)
            self.assertEqual(seen_scratch[0].parent, out_dir / ".scratch")
            self.assertTrue(seen_scratch[0].name.startswith("run-"))
            self.assertFalse(seen_scratch[0].exists())
            self.assertEqual(list((out_dir / ".scratch").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
