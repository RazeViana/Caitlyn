# @file tikTokMediaRequest.test.py
# @description Tests TikTok request boundaries, redirect resolution and streaming limits without networking.
# Runs in the existing isolated Python image with injected responses and in-memory file mocks.
# @module tikTokMediaRequest.test

import io
import http.cookiejar
import json
import os
import stat
import sys
import unittest
import urllib.error
from email.message import Message
from unittest.mock import mock_open, patch

sys.path.insert(0, "/opt/probe")
from tikTokMedia import checked_url, failure, load_context, metadata, open_checked, resolve_share, save_context, video


def response(mime="video/mp4", size=None, content=b"fixture"):
    result = unittest.mock.MagicMock()
    result.headers = Message()
    result.headers["Content-Type"] = mime
    if size is not None:
        result.headers["Content-Length"] = str(size)
    result.read.side_effect = [content, b""]
    result.__enter__.return_value = result
    return result


def redirect(url):
    return urllib.error.HTTPError("fixture", 302, "redirect", {"Location": url}, io.BytesIO())


class TikTokRequestTest(unittest.TestCase):
    def setUp(self):
        context = patch("tikTokMedia.load_context", return_value=({"User-Agent": "fixture", "Referer": "https://www.tiktok.com/@creator/video/123"}, http.cookiejar.CookieJar()))
        context.start()
        self.addCleanup(context.stop)

    def test_cdn_boundary_rejects_private_credentials_traversal_and_wrong_protocol(self):
        checked_url("https://v16-webapp-prime.tiktok.com/clip/", True)
        for url in ("https://127.0.0.1/file", "https://100.70.173.118/file", "https://user:secret@v16.tiktokcdn.com/file",
                    "https://v16.tiktokcdn.com:443/file", "https://v16.tiktokcdn.com/%2e%2e/file", "https://v16.tiktokcdn.com/../file",
                    "https://tiktokcdn.com.evil.test/file", "http://v16.tiktokcdn.com/file", "https://www.tiktok.com/file"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                checked_url(url, True)

    def test_short_share_resolves_to_canonical_video_without_fetching_target_or_copying_tracking(self):
        with patch("urllib.request.build_opener") as build:
            build.return_value.open.side_effect = redirect("https://www.tiktok.com/@creator/video/123?tracking=1")
            self.assertEqual(resolve_share("https://vm.tiktok.com/Example/"), "https://www.tiktok.com/@creator/video/123")
            self.assertEqual(build.return_value.open.call_count, 1)

    def test_share_redirects_to_private_external_login_profile_or_photo_routes_never_fetch_them(self):
        for target in ("https://127.0.0.1/file", "https://evil.test/file", "https://www.tiktok.com/login", "https://www.tiktok.com/@creator", "https://www.tiktok.com/@creator/photo/123"):
            with self.subTest(target=target), patch("urllib.request.build_opener") as build:
                build.return_value.open.side_effect = redirect(target)
                with self.assertRaises(ValueError):
                    resolve_share("https://vm.tiktok.com/Example/")
                self.assertEqual(build.return_value.open.call_count, 1)

    def test_redirect_loops_are_bounded(self):
        with patch("urllib.request.build_opener") as build:
            build.return_value.open.side_effect = redirect("https://vm.tiktok.com/Example/")
            with self.assertRaisesRegex(ValueError, "redirect_denied"):
                resolve_share("https://vm.tiktok.com/Example/")
            self.assertEqual(build.return_value.open.call_count, 1)

    def test_media_redirect_targets_are_checked_before_any_connection(self):
        with patch("urllib.request.build_opener") as build:
            build.return_value.open.side_effect = redirect("https://127.0.0.1/file")
            with self.assertRaisesRegex(ValueError, "invalid_input"):
                open_checked("https://v16.tiktokcdn.com/clip", True)
            self.assertEqual(build.return_value.open.call_count, 1)

    def test_access_denial_is_never_retried(self):
        for code in (401, 403, 429):
            with self.subTest(code=code), patch("urllib.request.build_opener") as build:
                error = urllib.error.HTTPError("fixture", code, "denied", {}, io.BytesIO())
                build.return_value.open.side_effect = error
                try:
                    with self.assertRaises(urllib.error.HTTPError):
                        open_checked("https://v16.tiktokcdn.com/clip", True)
                    self.assertEqual(build.return_value.open.call_count, 1)
                finally:
                    error.close()

    def test_fixed_proxy_identity_no_credentials_and_streamed_file(self):
        with patch("urllib.request.build_opener") as build, patch("builtins.open", mock_open()) as output:
            build.return_value.open.return_value = response()
            self.assertEqual(video("https://v16.tiktokcdn.com/clip", 1024)["bytes"], 7)
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(build.call_args.args[0].proxies, {"https": "http://127.0.0.1:3128"})
            self.assertNotIn("Cookie", dict(request.header_items()))
            self.assertEqual(request.get_header("Referer"), "https://www.tiktok.com/@creator/video/123")
            self.assertEqual(build.return_value.open.call_args.kwargs["timeout"], 8)
            output.assert_called_once_with("/tmp/x-video.mp4", "wb")

    def test_known_and_streamed_overflow_and_html_are_rejected(self):
        for reply, reason in ((response(size=1025), "size_limit"), (response(content=b"x" * 1025), "size_limit"), (response(mime="text/html"), "invalid_media")):
            with patch("urllib.request.build_opener") as build, patch("builtins.open", mock_open()):
                build.return_value.open.return_value = reply
                with self.assertRaisesRegex(ValueError, reason):
                    video("https://v16.tiktokcdn.com/clip", 1024)

    def test_unknown_diagnostics_never_escape(self):
        self.assertEqual(failure(ValueError("private signed URL https://example.test?token=secret")), "restricted")
        self.assertEqual(failure(ValueError("provider says secret")), "extractor_error")

    def test_compression_source_budget_is_bounded_before_connecting(self):
        with patch("urllib.request.build_opener") as build, patch("builtins.open", mock_open()):
            build.return_value.open.return_value = response(size=7)
            self.assertEqual(video("https://v16.tiktokcdn.com/clip", 48 * 1024 * 1024)["bytes"], 7)
            with self.assertRaisesRegex(ValueError, "invalid_input"):
                video("https://v16.tiktokcdn.com/clip", 48 * 1024 * 1024 + 1)
            self.assertEqual(build.return_value.open.call_count, 1)


class TikTokContextTest(unittest.TestCase):
    def test_anonymous_context_is_owner_only_and_never_uses_a_host_path(self):
        downloader = unittest.mock.MagicMock()
        with patch("os.open", return_value=100) as opened, patch("os.close"), patch("builtins.open", mock_open()), patch("os.stat") as info:
            info.return_value.st_size = 10
            save_context(downloader, "https://www.tiktok.com/@creator/video/123", "fixture")
            self.assertEqual(opened.call_count, 2)
            for call in opened.call_args_list:
                self.assertTrue(call.args[0].startswith("/tmp/tiktok-"))
                self.assertEqual(call.args[2], 0o600)
                self.assertTrue(call.args[1] & os.O_NOFOLLOW)
            downloader.cookiejar.save.assert_called_once_with(filename="/tmp/tiktok-anonymous-cookies.txt")

    def test_context_loading_checks_ownership_mode_size_headers_and_canonical_referer(self):
        valid = {"User-Agent": "fixture", "Referer": "https://www.tiktok.com/@creator/video/123"}
        for changes in ({}, {"Authorization": "never-use"}, {"User-Agent": "fixture\r\nCookie: secret"}, {"Referer": "https://evil.test/"}):
            with patch("os.stat") as info, patch("builtins.open", mock_open(read_data=json.dumps({**valid, **changes}))), patch("http.cookiejar.MozillaCookieJar") as jar:
                info.return_value.st_mode = stat.S_IFREG | 0o600
                info.return_value.st_uid = os.getuid()
                info.return_value.st_size = 100
                if changes:
                    with self.assertRaises(ValueError):
                        load_context()
                else:
                    headers, _cookies = load_context()
                    self.assertEqual(headers, valid)
                    jar.return_value.load.assert_called_once_with(ignore_discard=True, ignore_expires=False)
        for mode, size, uid in ((stat.S_IFREG | 0o644, 10, os.getuid()), (stat.S_IFLNK | 0o600, 10, os.getuid()), (stat.S_IFREG | 0o600, 65537, os.getuid()), (stat.S_IFREG | 0o600, 10, -1)):
            with patch("os.stat") as info:
                info.return_value.st_mode, info.return_value.st_size, info.return_value.st_uid = mode, size, uid
                with self.assertRaises(ValueError):
                    load_context()

    def test_metadata_never_returns_cookie_or_request_context_fields(self):
        value = {"id": "123", "uploader": "creator", "description": "fixture", "http_headers": {"Cookie": "never-export"},
                 "formats": [{"url": "https://v16.tiktokcdn.com/video/fixture", "http_headers": {"Cookie": "never-export"}, "ext": "mp4"}]}
        with patch("yt_dlp.extractor.tiktok.TikTokIE.extract", return_value=value), patch("tikTokMedia.save_context") as saved:
            output = metadata("https://www.tiktok.com/@creator/video/123")
            self.assertEqual(output["id"], "123")
            self.assertEqual(output["extractor_key"], "TikTok")
            self.assertNotIn("never-export", json.dumps(output))
            self.assertNotIn("http_headers", json.dumps(output))
            saved.assert_called_once()


if __name__ == "__main__":
    unittest.main()
