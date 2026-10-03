#!/usr/bin/env python3
"""Configure a separate test bot without exposing its token.

@file configureTestBot.py
@description Validates a privately entered Discord token against the prepared test application and saves it with owner-only permissions.
@module configure_test_bot
"""

import argparse
import datetime
import getpass
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, _request, _file, _code, _message, _headers, _url):
        raise ValueError("Discord returned an unexpected redirect; nothing was saved")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/mnt/Datashare/apps/caitlyn-test"))
    parser.add_argument("--token-file", type=Path, help="Read a private file containing only the bot token")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise ValueError("Run this command with sudo so the private test configuration can be updated")
    root = args.root.resolve(strict=True)
    if root.stat().st_uid != 0 or root.stat().st_mode & 0o077:
        raise ValueError("The test deployment directory must be root-owned and private")
    deployment = json.loads((root / "deployment.json").read_text())
    expected_id = deployment["application_id"]
    if not re.fullmatch(r"[1-9]\d*", expected_id):
        raise ValueError("The prepared test application ID is invalid")
    if args.token_file:
        token = args.token_file.read_text().strip()
    else:
        if not sys.stdin.isatty():
            raise ValueError("Use an interactive Mainframe terminal, or supply --token-file with a private file path")
        token = getpass.getpass("Separate caitlyn-test bot token (hidden): ").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{20,4096}", token):
        raise ValueError("The token format is invalid; nothing was saved")
    request = urllib.request.Request(
        "https://discord.com/api/v10/oauth2/applications/@me",
        headers={"Authorization": "Bot " + token, "User-Agent": "CaitlynTestSetup/2.2.0"},
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
            application = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f"Discord rejected the token (HTTP {error.code}); nothing was saved") from None
    except (urllib.error.URLError, TimeoutError):
        raise ValueError("Could not reach Discord to verify the token; nothing was saved") from None
    if str(application.get("id")) != expected_id:
        raise ValueError("This token belongs to a different application; nothing was saved")
    environment_file = root / "bot/bot.env"
    if environment_file.is_symlink():
        raise ValueError("Refusing a symbolic link for the private environment file")
    environment = environment_file.read_text()
    if len(re.findall(r"^TOKEN=.*$", environment, re.M)) != 1:
        raise ValueError("Expected exactly one TOKEN entry in the prepared environment")
    updated = re.sub(r"^TOKEN=.*$", lambda _: "TOKEN=" + token, environment, flags=re.M)
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = root / "backups" / ("bot.env.before-token-" + timestamp)
    descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(environment)
        output.flush()
        os.fsync(output.fileno())
    descriptor, temporary = tempfile.mkstemp(prefix=".bot.env-", dir=environment_file.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
        os.chown(temporary, 1000, 1000)
        os.chmod(temporary, 0o600)
        os.replace(temporary, environment_file)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print("Verified and saved the separate test bot token. Production credentials were not changed.")
    print("Tell Codex the token is saved so command registration and test-bot activation can finish.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        # Do not dump request objects, environment contents or a token-bearing traceback.
        print(str(error) if isinstance(error, ValueError) else "Could not update the private test configuration.", file=sys.stderr)
        sys.exit(1)
