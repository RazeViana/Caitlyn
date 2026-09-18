# @file instagramMediaFixture.py
# @description Exercises Instagram page parsing, URL boundaries and download failures with synthetic network-free fixtures.
# @module instagramMediaFixture

import io
import json
import os
import sys
import unittest
import urllib.error
from email.message import Message
from unittest.mock import patch

sys.path.insert(0, "/opt/probe")
import instagramMedia as adapter


def page(product):
    media = {"if_not_gated_logged_out": product}
    payload = {"require": [["fixture", None, None, [{"__bbox": {"require": [
        ["RelayPrefetchedStreamCache", None, None, [{"__bbox": {"result": {"data": {"xig_polaris_media": media}}}}]]
    ]}}]]]}
    return '<script type="application/json" data-sjs>' + json.dumps(payload) + '</script>'


class Response(io.BytesIO):
    def __init__(self, content, mime, length=None):
        super().__init__(content)
        self.headers = Message()
        self.headers["Content-Type"] = mime
        if length is not None:
            self.headers["Content-Length"] = str(length)


class InstagramFixture(unittest.TestCase):
    def test_product_and_carousel_keep_media_but_not_comments(self):
        photo = {"pk": "123", "media_type": 1, "caption": {"text": "Fixture", "secret": "discard"},
                 "user": {"username": "fixture", "full_name": "Test", "session": "discard"}, "comments": ["discard"]}
        result = adapter.parse_page(page(photo))
        self.assertEqual(result["caption"], {"text": "Fixture"})
        self.assertEqual(result["user"], {"username": "fixture", "full_name": "Test"})
        self.assertNotIn("comments", result)
        carousel = {**photo, "media_type": 8, "carousel_media_count": 2, "carousel_media": [photo, {"pk": "456", "media_type": 2, "has_audio": False}]}
        self.assertEqual([item["media_type"] for item in adapter.parse_page(page(carousel))["carousel_media"]], [1, 2])

    def test_missing_and_gated_metadata_have_closed_reasons(self):
        for value, reason in (("<html>empty</html>", "page_metadata_missing"), (page(None), "page_metadata_missing"), ("/accounts/login", "page_metadata_missing")):
            with self.assertRaisesRegex(ValueError, reason):
                adapter.parse_page(value)

    def test_public_query_preserves_metadata_and_explicit_restrictions(self):
        product = {"pk": 1234567890123456789, "media_type": 1, "caption": None}
        result = adapter.parse_query({"data": {"xig_polaris_media": {"if_not_gated_logged_out": product}}})
        self.assertEqual(result["pk"], "1234567890123456789")
        for value, reason in (({"message": "login_required"}, "login_required"), ({"require_login": True}, "login_required"),
                              ({"message": "challenge_required"}, "page_restricted"), ({"errors": [{"message": "private detail"}]}, "query_failed"),
                              ({"data": {"xig_polaris_media": None}}, "page_metadata_missing")):
            with self.assertRaisesRegex(ValueError, reason):
                adapter.parse_query(value)

    def test_hydration_is_one_fixed_anonymous_request_without_redirects(self):
        class Opener:
            calls = []

            def open(self, request, timeout):
                self.calls.append((request, timeout))
                return Response(json.dumps({"data": {"xig_polaris_media": {"if_not_gated_logged_out": {"pk": "1", "media_type": 1}}}}).encode(), "application/json")

        opener = Opener()
        result = adapter.public_query('["LSD",[],{"token":"fixture"}]', "https://www.instagram.com/p/B/", opener)
        self.assertEqual(result["pk"], "1")
        self.assertEqual(len(opener.calls), 1)
        request, timeout = opener.calls[0]
        self.assertEqual(request.full_url, "https://www.instagram.com/api/graphql")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(timeout, 8)
        self.assertIn(b"media_id", request.data)
        self.assertIsNone(request.get_header("Authorization"))
        with self.assertRaisesRegex(ValueError, "page_metadata_missing"):
            adapter.public_query("no page token", "https://www.instagram.com/p/B/", opener)
        self.assertEqual(len(opener.calls), 1)

    def test_nested_or_excessive_carousels_rejected(self):
        for nodes in ([{"carousel_media": []}], [{}] * 101, None):
            with self.assertRaisesRegex(ValueError, "output_limit"):
                adapter.product_fields({"carousel_media": nodes})

    def test_only_canonical_pages_and_cdn_media(self):
        adapter.checked_url("https://www.instagram.com/reel/AbC_-/")
        adapter.checked_url("https://scontent.cdninstagram.com/a.jpg?sig=fixture", True)
        for value in ("https://www.instagram.com/accounts/login/", "https://www.instagram.com/p/AbC/?track=yes", "https://www.instagram.com/share/p/AbC/",
                      "https://www.instagram.com/p/" + "a" * 29 + "/", "https://www.instagram.com/p/AbC/../", "https://www.instagram.com:443/p/AbC/"):
            with self.assertRaises(ValueError):
                adapter.checked_url(value)
        for value in ("https://127.0.0.1/a", "https://scontent.cdninstagram.com.evil.test/a", "https://scontent.cdninstagram.com/../a",
                      "https://scontent.cdninstagram.com/%2e%2e/a", "https://user:secret@scontent.cdninstagram.com/a", "http://scontent.cdninstagram.com/a"):
            with self.assertRaises(ValueError):
                adapter.checked_url(value, True)

    def test_redirects_are_never_followed(self):
        self.assertIsNone(adapter.NoRedirect().redirect_request(None, None, 302, "", {}, "https://www.instagram.com/accounts/login/"))
        for status, reason in ((301, "http_redirect"), (401, "http_401"), (403, "http_403"), (404, "http_404"), (429, "http_429")):
            self.assertEqual(adapter.failure(urllib.error.HTTPError("https://fixture", status, "private detail", {}, None)), reason)
        self.assertEqual(adapter.failure(Exception("private provider text")), "extractor_error")

    def test_metadata_bytes_and_encoding_are_bounded(self):
        with patch.object(adapter, "open_checked", return_value=Response(b"x" * (2 * 1024 * 1024 + 1), "text/html")):
            with self.assertRaisesRegex(ValueError, "output_limit"):
                adapter.metadata("https://www.instagram.com/p/AbC/")
        response = Response(b"fixture", "text/html")
        response.headers["Content-Encoding"] = "gzip"
        with patch.object(adapter, "open_checked", return_value=response):
            with self.assertRaisesRegex(ValueError, "invalid_input"):
                adapter.metadata("https://www.instagram.com/p/AbC/")

    def test_downloads_remove_overflow_truncated_or_wrong_mime_files(self):
        for response, reason in ((Response(b"x" * 1025, "image/png"), "size_limit"), (Response(b"x", "image/png", 2), "invalid_media"), (Response(b"html", "text/html"), "invalid_media")):
            with patch.object(adapter, "open_checked", return_value=response):
                with self.assertRaisesRegex(ValueError, reason):
                    adapter.download("image", "https://scontent.cdninstagram.com/a", 1024)
            self.assertFalse(os.path.exists("/tmp/x-image.bin"))

    def test_download_limits_and_fixed_paths(self):
        for kind, limit in (("image", 8 * 1024 * 1024 + 1), ("video", 48 * 1024 * 1024 + 1), ("image", 1023)):
            with self.assertRaisesRegex(ValueError, "invalid_input"):
                adapter.download(kind, "https://scontent.cdninstagram.com/a", limit)
        with patch.object(adapter, "open_checked", return_value=Response(b"fixture", "image/png", 7)):
            self.assertEqual(adapter.download("image", "https://scontent.cdninstagram.com/a", 1024), {"bytes": 7, "mime": "image/png"})
        os.unlink("/tmp/x-image.bin")


if __name__ == "__main__":
    result = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(InstagramFixture))
    print(json.dumps({"outcome": "verified" if result.wasSuccessful() else "failed", "tests": result.testsRun,
                      "failures": len(result.failures), "errors": len(result.errors)}))
    sys.exit(0 if result.wasSuccessful() else 1)
