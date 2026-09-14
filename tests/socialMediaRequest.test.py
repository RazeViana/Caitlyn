# @file socialMediaRequest.test.py
# @description Verifies X media request identity and safety using only the existing sandbox Python runtime.
# Runs without network access, credentials, filesystem writes, or additional packages.
# @module socialMediaRequest.test

import io
import sys
import unittest
import urllib.error
from contextlib import redirect_stdout
from email.message import Message
from unittest.mock import mock_open, patch

sys.path.insert(0, "/opt/probe")
from xMetadata import MEDIA_USER_AGENT, NoRedirect, media


class MediaRequestTest(unittest.TestCase):
    def test_explicit_identity_proxy_limits_and_no_credentials(self):
        for video, url, mime in (
            (False, "https://pbs.twimg.com/media/fixture.png?name=orig", "image/png"),
            (True, "https://video.twimg.com/ext_tw_video/fixture.mp4?tag=1", "video/mp4"),
        ):
            with self.subTest(video=video), patch("urllib.request.build_opener") as build, patch("builtins.open", mock_open()), redirect_stdout(io.StringIO()):
                response = build.return_value.open.return_value.__enter__.return_value
                response.headers = Message()
                response.headers["Content-Type"] = mime
                response.read.side_effect = [b"fixture", b""]
                media(url, video, 1024)
                request = build.return_value.open.call_args.args[0]
                self.assertEqual(request.full_url, url)
                self.assertEqual(dict(request.header_items()), {"User-agent": MEDIA_USER_AGENT})
                self.assertEqual(build.return_value.open.call_args.kwargs, {"timeout": 8})
                self.assertEqual(build.call_args.args[0].proxies, {"https": "http://127.0.0.1:3128"})
                self.assertIsInstance(build.call_args.args[1], NoRedirect)
                response.read.assert_called_with(65536)

    def test_access_denial_is_not_retried(self):
        with patch("urllib.request.build_opener") as build:
            error = urllib.error.HTTPError("fixture", 403, "Forbidden", {}, None)
            try:
                build.return_value.open.side_effect = error
                with self.assertRaises(urllib.error.HTTPError):
                    media("https://video.twimg.com/fixture.mp4", True)
                self.assertEqual(build.return_value.open.call_count, 1)
            finally:
                error.close()

    def test_unapproved_urls_never_open_a_connection(self):
        for url in ("http://video.twimg.com/a.mp4", "https://127.0.0.1/a.mp4", "https://video.twimg.com/../a.mp4", "https://evil.test/a.mp4"):
            with patch("urllib.request.build_opener") as build, self.assertRaisesRegex(ValueError, "invalid_input"):
                try:
                    media(url, True)
                finally:
                    build.assert_not_called()

    def test_redirects_are_not_followed(self):
        with self.assertRaisesRegex(ValueError, "redirect_denied"):
            NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://video.twimg.com/other.mp4")

    def test_oversized_responses_are_rejected_before_writing(self):
        with patch("urllib.request.build_opener") as build, patch("builtins.open") as output:
            response = build.return_value.open.return_value.__enter__.return_value
            response.headers = Message()
            response.headers["Content-Type"] = "video/mp4"
            response.headers["Content-Length"] = "1025"
            with self.assertRaisesRegex(ValueError, "size_limit"):
                media("https://video.twimg.com/fixture.mp4", True, 1024)
            output.assert_not_called()

    def test_compression_source_limit_is_video_only_and_checked_before_connecting(self):
        for video, limit in ((True, 48 * 1024 * 1024 + 1), (False, 8 * 1024 * 1024 + 1), (True, 1023), (True, True)):
            url = "https://video.twimg.com/fixture.mp4" if video else "https://pbs.twimg.com/media/fixture.png?name=orig"
            with patch("urllib.request.build_opener") as build, self.assertRaisesRegex(ValueError, "invalid_input"):
                try:
                    media(url, video, limit)
                finally:
                    build.assert_not_called()
        with patch("urllib.request.build_opener") as build, patch("builtins.open", mock_open()), redirect_stdout(io.StringIO()):
            response = build.return_value.open.return_value.__enter__.return_value
            response.headers = Message()
            response.headers["Content-Type"] = "video/mp4"
            response.headers["Content-Length"] = str(48 * 1024 * 1024)
            response.read.side_effect = [b"fixture", b""]
            media("https://video.twimg.com/fixture.mp4", True, 48 * 1024 * 1024)
            self.assertEqual(build.return_value.open.call_count, 1)

    def test_streamed_overflow_is_not_written_past_the_budget(self):
        with patch("urllib.request.build_opener") as build, patch("builtins.open", mock_open()) as output:
            response = build.return_value.open.return_value.__enter__.return_value
            response.headers = Message()
            response.headers["Content-Type"] = "video/mp4"
            response.read.side_effect = [b"a" * 1024, b"b", b""]
            with self.assertRaisesRegex(ValueError, "size_limit"):
                media("https://video.twimg.com/fixture.mp4", True, 1024)
            output().write.assert_called_once_with(b"a" * 1024)


if __name__ == "__main__":
    unittest.main()
