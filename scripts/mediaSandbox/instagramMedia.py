# @file instagramMedia.py
# @description Reads public Instagram page metadata with the pinned yt-dlp parser and downloads bounded media through the gateway.
# No account sessions, login retries, automatic redirects, comments, remote manifests or hosted fixer services.
# @module instagramMedia

import json
import http.cookiejar
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

PROXY = "http://127.0.0.1:3128"
USER_AGENT = "CaitlynMediaWorker/1.0 (+https://github.com/RazeViana/Caitlyn)"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def checked_url(value, media=False):
    if not isinstance(value, str) or len(value) > 8192 or re.search(r"[\s\\\x00-\x1f\x7f]", value):
        raise ValueError("invalid_input")
    parts = urllib.parse.urlsplit(value)
    if not re.match(r"^https://[a-zA-Z0-9.-]+/", value) or parts.username or parts.password or parts.port or parts.fragment:
        raise ValueError("invalid_input")
    if re.search(r"/(?:\.|\.\.)(?:/|$)|%(?:2e|2f|5c)", parts.path, re.I):
        raise ValueError("invalid_input")
    allowed = any(parts.hostname.endswith("." + host) for host in ("cdninstagram.com", "fbcdn.net")) if media else (
        parts.hostname == "www.instagram.com" and re.fullmatch(r"/(?:p|reel)/[a-zA-Z0-9_-]{1,28}/", parts.path) and not parts.query)
    if not allowed:
        raise ValueError("invalid_input")
    return parts


def open_checked(url, media=False, opener=None):
    checked_url(url, media)
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({"https": PROXY}), NoRedirect())
    # Redirects, including CDN redirects, fail closed. Never follow login/challenge/private routes.
    return opener.open(urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}), timeout=8)


def product_fields(product):
    if not isinstance(product, dict):
        raise ValueError("invalid_input")
    keys = ("pk", "code", "media_type", "caption", "user", "carousel_media_count", "image_versions2",
            "video_versions", "video_duration", "has_audio", "accessibility_caption")
    result = {key: product[key] for key in keys if key in product}
    if type(result.get("pk")) is int:
        # Instagram IDs exceed JavaScript's safe integer range; preserve their decimal digits across JSON.
        result["pk"] = str(result["pk"])
    user = result.get("user")
    if isinstance(user, dict):
        result["user"] = {key: user[key] for key in ("username", "full_name", "is_private") if key in user}
    caption = result.get("caption")
    if isinstance(caption, dict):
        result["caption"] = {"text": caption.get("text")}
    if "carousel_media" in product:
        nodes = product["carousel_media"]
        if not isinstance(nodes, list) or not 1 <= len(nodes) <= 100 or any(not isinstance(node, dict) or "carousel_media" in node for node in nodes):
            raise ValueError("output_limit")
        result["carousel_media"] = [product_fields(node) for node in nodes]
    return result


def parse_page(page):
    # Reuse the exact public-page schema parser from the already hash-pinned Instagram extractor.
    # Capture product data BEFORE yt-dlp turns carousels into video-only playlists.
    from yt_dlp.extractor.instagram import InstagramIE
    from yt_dlp.utils import traverse_obj

    media = traverse_obj(page, (
        {InstagramIE._SJS_RE.findall}, ..., {json.loads},
        "require", ..., ..., ..., "__bbox", "require",
        lambda _, value: value[0] == "RelayPrefetchedStreamCache", ...,
        lambda _, value: value["__bbox"]["result"]["data"]["xig_polaris_media"],
        "__bbox", "result", "data", "xig_polaris_media", {dict}, any))
    product = traverse_obj(media, ("if_not_gated_logged_out", {dict}))
    if not product:
        # Login links/footer text are present on public pages too; they do not prove restricted access.
        raise ValueError("page_metadata_missing")
    return product_fields(product)


def read_bounded(response, mime):
    if response.headers.get("Content-Encoding", "identity") != "identity" or response.headers.get_content_type() not in mime:
        raise ValueError("invalid_input")
    body = response.read(2 * 1024 * 1024 + 1)
    if len(body) > 2 * 1024 * 1024:
        raise ValueError("output_limit")
    return body.decode("utf-8", errors="strict")


def parse_query(value):
    if not isinstance(value, dict):
        raise ValueError("invalid_input")
    # Inspect only structured response status, never captions/comments or arbitrary notice substrings.
    if value.get("message") == "login_required" or value.get("require_login") is True:
        raise ValueError("login_required")
    if value.get("message") in ("checkpoint_required", "challenge_required"):
        raise ValueError("page_restricted")
    if value.get("errors") or value.get("status") == "fail":
        raise ValueError("query_failed")
    data = value.get("data")
    media = data.get("xig_polaris_media") if isinstance(data, dict) else None
    product = media.get("if_not_gated_logged_out") if isinstance(media, dict) else None
    if not isinstance(product, dict):
        raise ValueError("page_metadata_missing")
    return product_fields(product)


def public_query(page, url, opener):
    # A normal logged-out hydration request, adapted from the pinned InstagramIE query.
    # The anti-CSRF value belongs to this public page, is kept in memory, and is never logged.
    from yt_dlp import YoutubeDL
    from yt_dlp.extractor.instagram import InstagramIE, _id_to_pk

    match = re.search(r'\["LSD",\[\],\{"token":"([a-zA-Z0-9_-]{1,256})"', page)
    if not match:
        raise ValueError("page_metadata_missing")
    token = match[1]
    name = "PolarisLoggedOutDesktopWWWPostRootContentQuery"
    data = urllib.parse.urlencode({"lsd": token, "fb_api_caller_class": "RelayModern",
                                  "fb_api_req_friendly_name": name, "server_timestamps": "true",
                                  "variables": json.dumps({"media_id": str(_id_to_pk(url.rstrip("/").rsplit("/", 1)[1]))}),
                                  "doc_id": "27130156389949648"}).encode()
    with YoutubeDL({"cachedir": False, "quiet": True}, auto_init=False) as downloader:
        headers = InstagramIE(downloader)._api_headers
    request = urllib.request.Request("https://www.instagram.com/api/graphql", data=data, headers={**headers,
        "User-Agent": USER_AGENT, "Accept-Encoding": "identity", "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": name, "X-FB-LSD": token, "X-Requested-With": "XMLHttpRequest", "Referer": url})
    # Fixed same-origin endpoint; one request only. No redirect, auth, alternate query, or retry after denial.
    with opener.open(request, timeout=8) as response:
        body = read_bounded(response, ("application/json", "text/javascript"))
    return parse_query(json.loads(body.removeprefix("for (;;);")))


def metadata(url):
    cookies = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": PROXY}), NoRedirect(), urllib.request.HTTPCookieProcessor(cookies))
    with open_checked(url, opener=opener) as response:
        page = read_bounded(response, ("text/html",))
    try:
        return parse_page(page)
    except ValueError as error:
        if str(error) != "page_metadata_missing":
            raise
    return public_query(page, url, opener)


def download(kind, url, limit):
    if kind not in ("image", "video") or not 1024 <= limit <= (8 if kind == "image" else 48) * 1024 * 1024:
        raise ValueError("invalid_input")
    path = "/tmp/x-image.bin" if kind == "image" else "/tmp/x-video.mp4"
    allowed = ("image/jpeg", "image/png", "image/webp") if kind == "image" else ("video/mp4", "application/octet-stream")
    try:
        with open_checked(url, True) as response:
            mime = response.headers.get_content_type()
            if mime not in allowed or response.headers.get("Content-Encoding", "identity") != "identity":
                raise ValueError("invalid_media")
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > limit:
                raise ValueError("size_limit")
            size = 0
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                while chunk := response.read(min(65536, limit - size + 1)):
                    size += len(chunk)
                    if size > limit:
                        raise ValueError("size_limit")
                    output.write(chunk)
            if not size or (declared and int(declared) != size):
                raise ValueError("invalid_media")
            return {"bytes": size, "mime": mime}
    except Exception:
        if os.path.exists(path):
            os.unlink(path)
        raise


def failure(error):
    if isinstance(error, urllib.error.HTTPError):
        location = urllib.parse.urlsplit(urllib.parse.urljoin(error.url, error.headers.get("Location", "")))
        if 300 <= error.code < 400 and location.hostname == "www.instagram.com" and location.path.startswith("/accounts/login"):
            return "login_required"
        return {401: "http_401", 403: "http_403", 404: "http_404", 429: "http_429"}.get(error.code, "http_redirect" if 300 <= error.code < 400 else "extractor_error")
    message = str(error).lower()
    if message in ("invalid_input", "invalid_media", "size_limit", "output_limit", "restricted", "unavailable", "page_restricted", "page_metadata_missing", "login_required", "query_failed"):
        return message
    if re.search(r"timed? ?out|timeout", message):
        return "timeout"
    return "extractor_error"


if __name__ == "__main__":
    try:
        kind = sys.argv[1] if len(sys.argv) > 1 else ""
        if (kind == "metadata" and len(sys.argv) != 2) or (kind in ("image", "video") and len(sys.argv) != 3) or kind not in ("metadata", "image", "video"):
            raise ValueError("invalid_input")
        value = sys.stdin.read(8193)
        result = metadata(value) if kind == "metadata" else download(kind, value, int(sys.argv[2]))
        encoded = json.dumps(result)
        if len(encoded.encode()) > 1024 * 1024:
            raise ValueError("output_limit")
        print(encoded)
    except Exception as error:
        print(json.dumps({"failure": failure(error)}))
        sys.exit(1)
