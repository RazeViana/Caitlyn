# @file autoUpdate.py
# @description Applies complete main-branch releases through TrueNAS, with fixed image digests and rollback.
# @module deploymentAutoUpdate

from __future__ import annotations

import copy
import fcntl
import hashlib
import http.client
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


class UpdateError(Exception):
    """A closed diagnostic code; never carry child output, URLs or credentials."""


class UncertainUpdate(UpdateError):
    """An app job might still be running. Do not race it with another update."""


def require(condition, reason):
    if not condition:
        raise UpdateError(reason)


def private_directory(path):
    info = os.lstat(path)
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
            and info.st_mode & 0o077 == 0, "configuration_folder_not_private")


def read_private(path):
    private_directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                and info.st_uid == os.geteuid() and info.st_mode & 0o077 == 0,
                "configuration_file_not_private")
        data = stream.read(1_048_577)
        require(len(data) <= 1_048_576, "configuration_file_too_large")
        return json.loads(data)


def save_private(path, value):
    private_directory(path.parent)
    temporary = path.with_name(path.name + ".tmp")
    # A previous interrupted write needs review, not silent deletion.
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def validate_config(config):
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", config.get("repository", "")), "invalid_repository")
    require(re.fullmatch(r"[a-z][a-z0-9-]{0,50}", config.get("app", "")), "invalid_app_name")
    root = config.get("runtimeRoot", "")
    require(re.fullmatch(r"/mnt/[A-Za-z0-9_./-]+", root) and ".." not in root, "invalid_runtime_root")
    require(re.fullmatch(r"[a-f0-9]{64}", config.get("approvedMigrationHash", "")), "missing_database_approval")
    require(isinstance(config.get("enabled"), bool), "missing_update_switch")


def validate_manifest(manifest, config):
    require(isinstance(manifest, dict) and manifest.get("version") == 1
            and manifest.get("platform") == "linux/amd64"
            and manifest.get("repository") == config["repository"], "unsupported_release")
    require(re.fullmatch(r"[a-f0-9]{40}", manifest.get("revision", "")), "invalid_release_revision")
    require(manifest.get("migrationHash") == config["approvedMigrationHash"], "database_changes_need_review")
    require(re.fullmatch(r"[a-f0-9]{64}", manifest.get("inventoryHash", "")), "invalid_package_inventory_hash")
    images = manifest.get("images", {})
    require(isinstance(images, dict) and set(images) == {"bot", "broker", "fxembed", "media"}, "incomplete_image_set")
    for role, image in images.items():
        prefix = "ghcr.io/" + config["repository"].lower() + ("" if role == "bot" else "-" + role)
        require(isinstance(image, str) and re.fullmatch(re.escape(prefix) + r"@sha256:[a-f0-9]{64}", image), "untrusted_image_reference")
    return manifest


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        require(parsed.scheme == "https" and parsed.hostname in {
            "github.com", "api.github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"
        } and not parsed.username and not parsed.password, "download_redirect_rejected")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, limit, missing_ok=False):
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Caitlyn-release-updater", "Accept": "application/vnd.github+json"})
        with urllib.request.build_opener(SafeRedirect()).open(request, timeout=20) as response:
            data = response.read(limit + 1)
        require(len(data) <= limit, "release_download_too_large")
        return data
    except urllib.error.HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        raise UpdateError("release_download_failed") from None
    except (OSError, ValueError):
        raise UpdateError("release_download_failed") from None


def latest_release(config):
    base = "https://api.github.com/repos/" + config["repository"]
    data = download(base + "/releases/latest", 131_072, missing_ok=True)
    if data is None:
        return None
    release = json.loads(data)
    tag = release.get("tag_name", "")
    require(not release.get("draft") and not release.get("prerelease")
            and re.fullmatch(r"main-[a-f0-9]{40}", tag), "unexpected_release_tag")
    revision = tag[5:]
    require(release.get("target_commitish") == revision, "release_target_mismatch")
    branch = json.loads(download(base + "/branches/main", 131_072))
    if branch.get("commit", {}).get("sha") != revision:
        logging.info("Waiting for the latest main commit to finish building")
        return None
    assets = {item.get("name"): item.get("browser_download_url") for item in release.get("assets", [])}
    prefix = "https://github.com/" + config["repository"] + "/releases/download/" + tag + "/"
    for name in ("caitlyn-release.json", "caitlyn-installations.json"):
        require(assets.get(name) == prefix + name, "release_asset_missing_or_untrusted")
    manifest = validate_manifest(json.loads(download(assets["caitlyn-release.json"], 16_384)), config)
    require(manifest["revision"] == revision, "release_revision_mismatch")
    packages = download(assets["caitlyn-installations.json"], 2_097_152)
    require(hashlib.sha256(packages).hexdigest() == manifest["inventoryHash"], "package_inventory_mismatch")
    inventory = json.loads(packages)
    require(inventory.get("revision") == revision and set(inventory.get("images", {})) == set(manifest["images"]), "package_inventory_mismatch")
    for role, item in inventory["images"].items():
        require(item.get("image") == manifest["images"][role] and item.get("osPackages") and item.get("npmPackages"), "package_inventory_mismatch")
    return manifest, inventory


def candidate_compose(current, images):
    require(set(current.get("services", {})) == {"caitlyn", "broker", "fxembed"}, "service_layout_needs_review")
    result = copy.deepcopy(current)
    for role, name in (("bot", "caitlyn"), ("broker", "broker"), ("fxembed", "fxembed")):
        service = result["services"][name]
        require(service.get("read_only") is True and service.get("pull_policy") == "never", "service_policy_needs_review")
        service["image"] = images[role]
    result["services"]["broker"]["environment"]["SOCIAL_WORKER_IMAGE"] = images["media"]
    return result


class Operations:
    def __init__(self, config, directory):
        self.config = config
        self.directory = directory
        self.app = config["app"]

    def command(self, args, timeout=30):
        try:
            result = subprocess.run(args, capture_output=True, timeout=timeout, check=True)
            require(len(result.stdout) <= 2_097_152, "command_output_too_large")
            return result.stdout.decode().strip()
        except subprocess.TimeoutExpired:
            raise UpdateError("server_command_timed_out") from None
        except subprocess.CalledProcessError as error:
            raise UpdateError("server_command_exit_" + str(error.returncode)) from None
        except OSError as error:
            raise UpdateError("server_command_os_error_" + str(error.errno)) from None
        except (subprocess.SubprocessError, UnicodeError):
            raise UpdateError("server_command_failed") from None

    def api(self, method, *args):
        # TrueNAS ships this client with midclt. Use its local socket directly:
        # sudo's command checking can kill midclt when a long Compose argument
        # is truncated during argv verification. Configuration stays off argv.
        try:
            from truenas_api_client import Client
        except ImportError:
            raise UpdateError("truenas_client_missing") from None
        try:
            with Client(call_timeout=30) as client:
                return client.call(method, *args)
        except Exception:
            # API errors can include submitted configuration; never log them.
            raise UpdateError("server_api_failed") from None

    def job(self, method, *args):
        require(method in {"app.stop", "app.update", "app.start"}, "unsupported_app_job")
        logging.info("Asking TrueNAS to run %s", method)
        try:
            identifier = self.api(method, *args)
        except UpdateError as error:
            logging.error("TrueNAS did not confirm a job number for %s (%s); the request will not be repeated", method, error)
            raise UncertainUpdate("app_job_number_unknown") from None
        if type(identifier) is not int or identifier <= 0:
            raise UncertainUpdate("app_job_number_unknown")
        logging.info("TrueNAS accepted %s as job %d", method, identifier)
        deadline = time.monotonic() + 300
        missed_checks = 0
        while time.monotonic() < deadline:
            try:
                jobs = self.api("core.get_jobs", [["id", "=", identifier]], {"select": ["id", "state"]})
                require(isinstance(jobs, list) and len(jobs) == 1
                        and isinstance(jobs[0], dict) and jobs[0].get("id") == identifier
                        and jobs[0].get("state") in {"WAITING", "RUNNING", "SUCCESS", "FAILED", "ABORTED"},
                        "app_job_status_missing")
            except UpdateError as error:
                missed_checks += 1
                if missed_checks == 1 or missed_checks % 10 == 0:
                    logging.warning("Could not read %s job %d (%s); checking that same job again", method, identifier, error)
                # Reading a known job is safe to repeat. Never repeat the app mutation.
                time.sleep(2)
                continue
            if missed_checks:
                logging.info("TrueNAS job %d status is available again", identifier)
                missed_checks = 0
            if jobs[0]["state"] == "SUCCESS":
                logging.info("TrueNAS finished %s job %d", method, identifier)
                return
            if jobs[0]["state"] in ("FAILED", "ABORTED"):
                raise UpdateError("app_job_failed")
            time.sleep(2)
        logging.error("Could not confirm completion of %s job %d within five minutes", method, identifier)
        raise UncertainUpdate("app_job_still_running")

    def current(self):
        apps = self.api("app.query", [["id", "=", self.app]], {"select": ["id", "state"]})
        require(len(apps) == 1, "app_missing")
        return apps[0]["state"], self.api("app.config", self.app)

    def worker_idle(self):
        connection = http.client.HTTPConnection("localhost", timeout=3)
        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.sock.settimeout(3)
        try:
            connection.sock.connect(self.config["runtimeRoot"] + "/ipc/worker.sock")
            connection.request("GET", "/v1/health")
            response = connection.getresponse()
            value = json.loads(response.read(4097))
            require(response.status == 200 and value.get("service") == "caitlyn-media", "media_worker_not_ready")
            return value.get("status") == "idle"
        except (OSError, ValueError, http.client.HTTPException):
            raise UpdateError("media_worker_not_ready") from None
        finally:
            connection.close()

    def resources_clean(self):
        require(not self.command(["docker", "ps", "-aq", "--filter=label=dev.caitlyn.social-worker=true"])
                and not self.command(["docker", "volume", "ls", "-q", "--filter=label=dev.caitlyn.social-worker=true"]), "temporary_workers_need_review")

    def pull(self, manifest):
        images = {}
        for role, reference in manifest["images"].items():
            logging.info("Downloading the %s image for %s", role, manifest["revision"][:12])
            self.command(["docker", "pull", reference], timeout=600)
            details = json.loads(self.command(["docker", "image", "inspect", reference]))[0]
            require(details.get("Architecture") == "amd64" and details.get("Os") == "linux"
                    and details.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision") == manifest["revision"], "downloaded_image_identity_mismatch")
            image = details.get("Id", "")
            require(re.fullmatch(r"sha256:[a-f0-9]{64}", image), "downloaded_image_identity_mismatch")
            images[role] = image
        return images

    def preflight(self, image):
        # No Discord login, writes or database migrations. Credentials are a read-only mount, not argv values.
        self.command(["docker", "run", "--rm", "--pull=never", "--read-only", "--user=1000:1000", "--cap-drop=ALL",
                      "--security-opt=no-new-privileges", "--memory=256m", "--pids-limit=64", "--log-driver=none",
                      "--env=DOTENV_CONFIG_PATH=/run/caitlyn-bot/bot.env", "--env=LLM_ENABLED=false", "--env=SOCIAL_MEDIA_ENABLED=true",
                      "--mount=type=bind,source=" + self.config["runtimeRoot"] + "/bot,target=/run/caitlyn-bot,readonly",
                      "--entrypoint=timeout", image, "-s", "KILL", "90", "node", "/app/scripts/deployment/checkRelease.mjs"], timeout=100)

    def save(self, state):
        save_private(self.directory / "state.json", state)

    def archive(self, revision, current, inventory):
        destination = self.directory / revision
        destination.mkdir(mode=0o700, exist_ok=True)
        private_directory(destination)
        save_private(destination / "previous-compose.json", current)
        save_private(destination / "installations.json", inventory)

    def replace(self, compose):
        status, _ = self.current()
        if status != "STOPPED":
            self.job("app.stop", self.app)
        self.job("app.update", self.app, {"custom_compose_config": compose})
        self.job("app.start", self.app)

    def verify(self, compose):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            ready = True
            for name in ("fxembed", "broker", "caitlyn"):
                container = "ix-" + self.app + "-" + name + "-1"
                details = json.loads(self.command(["docker", "inspect", container]))[0]
                state = details["State"]
                require(not state.get("OOMKilled") and details.get("RestartCount") == 0, "new_service_restarted")
                require(details.get("Image") == compose["services"][name]["image"], "running_image_mismatch")
                ready = ready and state.get("Running")
                if name != "caitlyn":
                    ready = ready and state.get("Health", {}).get("Status") == "healthy"
                else:
                    logs = self.command(["docker", "logs", "--since", state["StartedAt"], "--tail=200", container])
                    ready = ready and "Bot started successfully" in logs
            if ready:
                return
            time.sleep(2)
        raise UpdateError("new_services_not_ready")

    def commands(self):
        self.command(["docker", "exec", "ix-" + self.app + "-caitlyn-1", "timeout", "-s", "KILL", "50",
                      "node", "dist/core/deployCommands.js"], timeout=60)


def apply_release(manifest, inventory, config, state, operations):
    validate_manifest(manifest, config)
    revision = manifest["revision"]
    require(state.get("phase", "idle") == "idle", "unfinished_update_needs_review")
    if revision in (state.get("revision"), state.get("blockedRevision")):
        return "unchanged"
    status, current = operations.current()
    if status != "RUNNING":
        logging.info("The app is stopped or not ready; leaving it unchanged")
        return "deferred"
    candidate_compose(current, {key: "sha256:" + "0" * 64 for key in manifest["images"]})
    if not operations.worker_idle():
        return "busy"
    operations.resources_clean()
    images = operations.pull(manifest)
    operations.preflight(images["bot"])
    # A person may stop or reconfigure the app while images download.
    after_status, after_compose = operations.current()
    require(after_status == "RUNNING" and after_compose == current, "app_changed_during_download")
    if not operations.worker_idle():
        return "busy"
    operations.resources_clean()
    candidate = candidate_compose(current, images)
    operations.archive(revision, current, inventory)
    pending = {**state, "phase": "updating", "pendingRevision": revision, "previousCompose": current}
    operations.save(pending)
    try:
        logging.info("Updating Caitlyn and its media services to %s", revision[:12])
        operations.replace(candidate)
        operations.verify(candidate)
        operations.commands()
    except UncertainUpdate:
        logging.error("An app update may still be running; automatic updates are paused for review")
        raise
    except UpdateError as error:
        logging.error("The release did not pass its checks (%s); restoring the previous app and commands", error)
        pending["phase"] = "rolling_back"
        operations.save(pending)
        operations.replace(current)
        operations.verify(current)
        operations.commands()
        operations.save({**state, "phase": "idle", "blockedRevision": revision})
        logging.warning("Previous version restored; this failed release will not be retried automatically")
        return "rolled_back"
    operations.save({"phase": "idle", "revision": revision, "images": images})
    logging.info("Caitlyn is online; all four release images checked and guild commands registered")
    return "updated"


def main():
    require(len(sys.argv) in (2, 3) and (len(sys.argv) == 2 or sys.argv[2] == "--check"), "invalid_arguments")
    config_path = Path(sys.argv[1])
    require(config_path.is_absolute(), "absolute_configuration_path_required")
    config = read_private(config_path)
    validate_config(config)
    directory = config_path.parent
    os.umask(0o077)
    handler = RotatingFileHandler(directory / "updates.log", maxBytes=1_048_576, backupCount=3)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=[handler, logging.StreamHandler()])
    logging.Formatter.converter = time.gmtime
    lock_fd = os.open(directory / "update.lock", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if not config["enabled"]:
            return
        state_path = directory / "state.json"
        state = read_private(state_path) if state_path.exists() else {"phase": "idle"}
        require(state.get("phase", "idle") == "idle", "unfinished_update_needs_review")
        release = latest_release(config)
        if release is None:
            return
        manifest, inventory = release
        if len(sys.argv) == 3:
            logging.info("Release %s passed metadata checks; no services changed", manifest["revision"][:12])
            return
        apply_release(manifest, inventory, config, state, Operations(config, directory))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        reason = str(error) if isinstance(error, UpdateError) else "unexpected_update_error"
        logging.error("Automatic update needs attention: %s. Check the saved update state before retrying", reason)
        sys.exit(1)
