# @file xMetadata.py
# @description Retrieves public X metadata or bounded image/video bytes through the isolated proxy.
# @module xMetadata

import json
import re
import sys
import urllib.error
import urllib.request

from yt_dlp import YoutubeDL
from yt_dlp.extractor.twitter import TwitterIE


class QuietLogger:
    """Provider errors may contain content or signed URLs; never forward them."""

    def debug(self, message):
        pass

    def warning(self, message):
        pass

    def error(self, message):
        pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError("redirect_denied")


def metadata(post_id):
    if not re.fullmatch(r"[1-9]\d{0,24}", post_id):
        raise ValueError("invalid_input")
    # Direct GraphQL call deliberately avoids _extract_status's automatic 429 fallback
    # and legacy conversion, which discards quote authors and long-form text.
    with YoutubeDL({
        "proxy": "http://127.0.0.1:3128", "socket_timeout": 8,
        "cachedir": False, "quiet": True, "logger": QuietLogger(),
        "retries": 0, "extractor_retries": 0, "fragment_retries": 0,
    }) as downloader:
        extractor = TwitterIE(downloader)
        extractor.initialize()
        data = extractor._call_graphql_api(extractor._GRAPHQL_ENDPOINT, post_id)
        encoded = json.dumps(data, ensure_ascii=True)
        if len(encoded) > 1024 * 1024:
            raise ValueError("output_limit")
        print(encoded)


def media(url, is_video=False):
    pattern = (r"https://video\.twimg\.com/[a-zA-Z0-9_./-]+\.mp4(?:\?[a-zA-Z0-9_=&.-]*)?" if is_video
               else r"https://pbs\.twimg\.com/media/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)\?name=orig")
    if not re.fullmatch(pattern, url) or "/../" in url or "/./" in url:
        raise ValueError("invalid_input")
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": "http://127.0.0.1:3128"}), NoRedirect(),
    )
    with opener.open(url, timeout=8) as response:
        mime = response.headers.get_content_type()
        if mime not in (("video/mp4", "application/octet-stream") if is_video else ("image/jpeg", "image/png", "image/webp")):
            raise ValueError("invalid_media")
        # These are local test budgets, not an assumed Discord server limit.
        limit = (10 if is_video else 12) * 1024 * 1024
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > limit:
            raise ValueError("size_limit")
        size = 0
        with open("/tmp/x-video.mp4" if is_video else "/tmp/x-image.bin", "wb") as output:
            while chunk := response.read(65536):
                size += len(chunk)
                if size > limit:
                    raise ValueError("size_limit")
                output.write(chunk)
        if not size:
            raise ValueError("invalid_image")
        print(json.dumps({"bytes": size, "mime": mime}))


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3 or sys.argv[1] not in ("metadata", "image", "video"):
            raise ValueError("invalid_input")
        if sys.argv[1] == "metadata":
            metadata(sys.argv[2])
        else:
            media(sys.argv[2], sys.argv[1] == "video")
    except Exception as error:
        # Classify internally; no raw exception, response, cookie, or request URL leaves this process.
        message = str(error).lower()
        category = "extractor_error"
        for pattern, outcome in (
            (r"429|rate.?limit", "rate_limited"),
            (r"sign.?in|log.?in|authentication|protected|nsfw", "login_or_restriction"),
            (r"403|forbidden", "access_denied"),
            (r"404|unavailable|not found", "unavailable"),
            (r"timed? ?out|timeout", "timeout"),
            (r"size_limit|output_limit|invalid_input|invalid_image|invalid_media|redirect_denied", message),
        ):
            if re.search(pattern, message):
                category = outcome if outcome in (
                    "rate_limited", "login_or_restriction", "access_denied", "unavailable",
                    "timeout", "size_limit", "output_limit", "invalid_input", "invalid_image", "invalid_media", "redirect_denied",
                ) else "extractor_error"
                break
        print(json.dumps({"failure": category}))
        sys.exit(1)
