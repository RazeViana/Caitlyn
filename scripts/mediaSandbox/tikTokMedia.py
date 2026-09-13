# @file tikTokMedia.py
# @description Extracts public TikTok metadata and streams bounded MP4s through the isolated gateway.
# No account cookies, host files, automatic downloads, unrestricted redirects, or raw diagnostics are used.
# @module tikTokMedia

import json
import http.cookiejar
import os
import re
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request

CDN_DOMAINS = ("tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "tiktokv.us", "muscdn.com", "byteoversea.com", "ibytedtos.com")
PAGE_HOSTS = ("www.tiktok.com", "tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com")
USER_AGENT = "CaitlynMediaWorker/1.0 (+https://github.com/RazeViana/Caitlyn)"
PROXY = "http://127.0.0.1:3128"
CONTEXT_PATH = "/tmp/tiktok-request.json"
COOKIES_PATH = "/tmp/tiktok-anonymous-cookies.txt"


def save_context(downloader, referer, user_agent):
    # These cookies came only from this disposable public-page request, never a host/browser session.
    for path in (CONTEXT_PATH, COOKIES_PATH):
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
    with open(CONTEXT_PATH, "w", encoding="utf8") as output:
        json.dump({"User-Agent": user_agent, "Referer": referer}, output)
    downloader.cookiejar.save(filename=COOKIES_PATH)
    if os.stat(COOKIES_PATH).st_size > 65536:
        raise ValueError("output_limit")


def load_context():
    for path in (CONTEXT_PATH, COOKIES_PATH):
        info = os.stat(path, follow_symlinks=False)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 65536:
            raise ValueError("invalid_input")
    with open(CONTEXT_PATH, encoding="utf8") as source:
        headers = json.load(source)
    if not isinstance(headers, dict) or set(headers) != {"User-Agent", "Referer"}:
        raise ValueError("invalid_input")
    if not isinstance(headers["User-Agent"], str) or not re.fullmatch(r"[\x20-\x7e]{1,512}", headers["User-Agent"]):
        raise ValueError("invalid_input")
    if canonical_post(headers["Referer"]) != headers["Referer"]:
        raise ValueError("invalid_input")
    cookies = http.cookiejar.MozillaCookieJar(COOKIES_PATH)
    cookies.load(ignore_discard=True, ignore_expires=False)
    return headers, cookies


def checked_url(value, media=False):
    if not isinstance(value, str) or len(value) > 8192 or re.search(r"[\s\\\x00-\x1f\x7f]", value):
        raise ValueError("invalid_input")
    parts = urllib.parse.urlsplit(value)
    if not re.match(r"^https://[a-zA-Z0-9.-]+/", value) or parts.username or parts.password or parts.port or parts.fragment:
        raise ValueError("invalid_input")
    if re.search(r"/(?:\.|\.\.)(?:/|$)|%(?:2e|2f|5c)", parts.path, re.I):
        raise ValueError("invalid_input")
    allowed = (any(parts.hostname == host or parts.hostname.endswith("." + host) for host in CDN_DOMAINS)
               or re.fullmatch(r"v\d{1,3}-webapp(?:-prime)?\.tiktok\.com", parts.hostname)) if media else parts.hostname in PAGE_HOSTS
    if not allowed:
        raise ValueError("invalid_input")
    return parts


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


def open_checked(url, media=False):
    headers, cookies = load_context() if media else ({"User-Agent": USER_AGENT}, http.cookiejar.CookieJar())
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": PROXY}), NoRedirect(), urllib.request.HTTPCookieProcessor(cookies))
    seen = set()
    for _ in range(4):
        checked_url(url, media)
        if url in seen:
            raise ValueError("redirect_denied")
        seen.add(url)
        try:
            return opener.open(urllib.request.Request(url, headers={**headers, "Accept-Encoding": "identity"}), timeout=8)
        except urllib.error.HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise
            location = error.headers.get("Location")
            error.close()
            if not location:
                raise ValueError("redirect_denied") from None
            url = urllib.parse.urljoin(url, location)
    raise ValueError("redirect_denied")


def canonical_post(url):
    parts = checked_url(url)
    match = re.fullmatch(r"/@([a-zA-Z0-9_.]{1,32})/(video|photo)/([1-9]\d{0,24})/?", parts.path)
    if not match:
        return None
    if match[2] != "video":
        raise ValueError("unsupported")
    return f"https://www.tiktok.com/@{match[1]}/video/{match[3]}"


def resolve_share(url):
    direct = canonical_post(url)
    if direct:
        return direct
    parts = checked_url(url)
    if not (parts.hostname in ("vm.tiktok.com", "vt.tiktok.com") and re.fullmatch(r"/[a-zA-Z0-9]{1,64}/?", parts.path)
            or parts.hostname in ("www.tiktok.com", "tiktok.com", "m.tiktok.com") and re.fullmatch(r"/t/[a-zA-Z0-9]{1,64}/?", parts.path)):
        raise ValueError("invalid_input")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": PROXY}), NoRedirect())
    seen = set()
    for _ in range(4):
        checked_url(url)
        if url in seen:
            raise ValueError("redirect_denied")
        seen.add(url)
        direct = canonical_post(url)
        if direct:
            return direct
        # Never follow profile, login, or challenge routes while resolving a share.
        parts = checked_url(url)
        if not (parts.hostname in ("vm.tiktok.com", "vt.tiktok.com") and re.fullmatch(r"/[a-zA-Z0-9]{1,64}/?", parts.path)
                or parts.hostname in ("www.tiktok.com", "tiktok.com", "m.tiktok.com") and re.fullmatch(r"/t/[a-zA-Z0-9]{1,64}/?", parts.path)):
            raise ValueError("restricted" if parts.path.startswith("/login") else "unsupported")
        try:
            with opener.open(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=8):
                raise ValueError("unsupported")
        except urllib.error.HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise
            location = error.headers.get("Location")
            error.close()
            if not location:
                raise ValueError("redirect_denied") from None
            url = urllib.parse.urljoin(url, location)
    raise ValueError("redirect_denied")


def metadata(url):
    # The image already contains this hash-pinned dependency; never install/update at runtime.
    from yt_dlp import YoutubeDL
    from yt_dlp.extractor.tiktok import TikTokIE
    from yt_dlp.utils.networking import std_headers

    class QuietLogger:
        def debug(self, _message):
            pass

        warning = debug
        error = debug

    class BoundedDownloader(YoutubeDL):
        def urlopen(self, request):
            checked_url(request if isinstance(request, str) else request.url)
            response = super().urlopen(request)
            original_read = response.read
            remaining = 2 * 1024 * 1024

            def read(amount=-1):
                nonlocal remaining
                data = original_read(min(amount, remaining + 1) if amount is not None and amount >= 0 else remaining + 1)
                remaining -= len(data)
                if remaining < 0:
                    response.close()
                    raise ValueError("output_limit")
                return data

            response.read = read
            return response

    resolved = resolve_share(url)
    with BoundedDownloader({"proxy": PROXY, "socket_timeout": 8, "retries": 0, "extractor_retries": 0,
                            "fragment_retries": 0, "cachedir": False, "logger": QuietLogger(),
                            "quiet": True, "noprogress": True, "skip_download": True, "http_headers": {"User-Agent": std_headers["User-Agent"]},
                            "noplaylist": True, "check_formats": False}, auto_init=False) as downloader:
        extracted = TikTokIE(downloader).extract(resolved)
        save_context(downloader, resolved, std_headers["User-Agent"])
    if not isinstance(extracted, dict) or str(extracted.get("id")) != resolved.rsplit("/", 1)[1]:
        raise ValueError("invalid_input")
    formats = extracted.get("formats", [])
    if not isinstance(formats, list) or len(formats) > 128:
        raise ValueError("output_limit")
    # Deliberately omit cookies, headers, thumbnails, subtitles, arbitrary requests and provider traces.
    keys = ("url", "ext", "protocol", "vcodec", "acodec", "tbr", "width", "height", "filesize", "filesize_approx")
    output = {key: extracted[key] for key in ("id", "uploader", "channel", "description", "duration", "availability", "age_limit", "is_live", "live_status", "_type") if key in extracted}
    output["extractor_key"] = "TikTok"
    output["formats"] = [{key: item[key] for key in keys if key in item} for item in formats if isinstance(item, dict)]
    return output


def video(url, limit):
    if not 1024 <= limit <= 8 * 1024 * 1024:
        raise ValueError("invalid_input")
    with open_checked(url, True) as response:
        mime = response.headers.get_content_type()
        if mime not in ("video/mp4", "application/octet-stream") or response.headers.get("Content-Encoding", "identity") != "identity":
            raise ValueError("invalid_media")
        declared = response.headers.get("Content-Length")
        if declared and int(declared) > limit:
            raise ValueError("size_limit")
        size = 0
        # Shared video verifier reads this fixed disposable path, never a provider-selected filename.
        with open("/tmp/x-video.mp4", "wb") as output:
            while chunk := response.read(65536):
                size += len(chunk)
                if size > limit:
                    raise ValueError("size_limit")
                output.write(chunk)
        if not size:
            raise ValueError("invalid_media")
        return {"bytes": size, "mime": mime}


def failure(error):
    message = str(error).lower()
    known = ("invalid_input", "output_limit", "redirect_denied", "unsupported", "restricted", "size_limit", "invalid_media")
    if message in known:
        return message
    for pattern, outcome in ((r"tunnel connection failed.*403", "gateway_denied"), (r"429|rate.?limit", "rate_limited"),
                             (r"sign.?in|log.?in|authentication|age.?restrict|private|friends.only|ip address is blocked", "restricted"),
                             (r"401|403|forbidden", "access_denied"), (r"404|unavailable|not available|not found|removed", "unavailable"),
                             (r"timed? ?out|timeout", "timeout"), (r"no video|no formats", "unsupported")):
        if re.search(pattern, message):
            return outcome
    return "extractor_error"


if __name__ == "__main__":
    try:
        if len(sys.argv) not in (2, 3) or sys.argv[1] not in ("metadata", "video"):
            raise ValueError("invalid_input")
        value = sys.stdin.read(8193)
        result = metadata(value) if sys.argv[1] == "metadata" else video(value, int(sys.argv[2]))
        encoded = json.dumps(result)
        if len(encoded.encode()) > 1024 * 1024:
            raise ValueError("output_limit")
        print(encoded)
    except Exception as error:
        print(json.dumps({"failure": failure(error)}))
        sys.exit(1)
