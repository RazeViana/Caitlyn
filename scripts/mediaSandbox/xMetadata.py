# @file xMetadata.py
# @description Downloads bounded anonymous CDN media; metadata is supplied by the local FxEmbed backend.
# @module xMetadata

import json
import re
import sys
import urllib.error
import urllib.request

MEDIA_USER_AGENT = "CaitlynMediaWorker/1.0 (+https://github.com/RazeViana/Caitlyn)"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError("redirect_denied")


def media(url, is_video=False, byte_limit=None):
    pattern = (r"https://video\.twimg\.com/[a-zA-Z0-9_./-]+\.mp4(?:\?[a-zA-Z0-9_=&.-]*)?" if is_video
               else r"https://pbs\.twimg\.com/media/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)\?name=orig")
    if not re.fullmatch(pattern, url) or "/../" in url or "/./" in url:
        raise ValueError("invalid_input")
    # Only temporary compression inputs may reach 48 MiB; image and delivered-file caps stay unchanged.
    limit = (10 if is_video else 12) * 1024 * 1024
    if byte_limit is not None:
        maximum = (48 if is_video else 8) * 1024 * 1024
        if type(byte_limit) is not int or not 1024 <= byte_limit <= maximum:
            raise ValueError("invalid_input")
        limit = byte_limit
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": "http://127.0.0.1:3128"}), NoRedirect(),
    )
    # Identify this application rather than urllib's generic Python client. No browser impersonation,
    # cookies, referer spoofing, authentication, or alternate-host fallback is used.
    request = urllib.request.Request(url, headers={"User-Agent": MEDIA_USER_AGENT})
    with opener.open(request, timeout=8) as response:
        mime = response.headers.get_content_type()
        if mime not in (("video/mp4", "application/octet-stream") if is_video else ("image/jpeg", "image/png", "image/webp")):
            raise ValueError("invalid_media")
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
        if len(sys.argv) not in (3, 4) or sys.argv[1] not in ("image", "video"):
            raise ValueError("invalid_input")
        media(sys.argv[2], sys.argv[1] == "video", int(sys.argv[3]) if len(sys.argv) == 4 else None)
    except Exception as error:
        # Classify internally; no raw exception, response, cookie, or request URL leaves this process.
        message = str(error).lower()
        category = "extractor_error"
        for pattern, outcome in (
            (r"tunnel connection failed.*403", "gateway_denied"),
            (r"429|rate.?limit", "rate_limited"),
            (r"sign.?in|log.?in|authentication|protected|nsfw", "login_or_restriction"),
            (r"401|403|forbidden", "access_denied"),
            (r"404|unavailable|not found", "unavailable"),
            (r"timed? ?out|timeout", "timeout"),
            (r"size_limit|output_limit|invalid_input|invalid_image|invalid_media|redirect_denied", message),
        ):
            if re.search(pattern, message):
                category = outcome if outcome in (
                    "rate_limited", "login_or_restriction", "access_denied", "gateway_denied", "unavailable",
                    "timeout", "size_limit", "output_limit", "invalid_input", "invalid_image", "invalid_media", "redirect_denied",
                ) else "extractor_error"
                break
        print(json.dumps({"failure": category}))
        sys.exit(1)
