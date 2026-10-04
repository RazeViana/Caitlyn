"""@file backup.py
@description Creates private PostgreSQL/file backups and verifies restoration in a disposable, network-isolated container.
@module transcription_backup
"""

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid


def run(arguments, **kwargs):
    return subprocess.run(arguments, check=True, stderr=subprocess.PIPE, **kwargs)


def private_json(path, value, owner=None):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    if owner:
        os.chown(temporary, *owner)
    temporary.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def validate(config):
    for key in ("app", "role", "database"):
        if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,62}", config[key]):
            raise ValueError("Invalid backup identity")
    if not config["container"].startswith("ix-" + config["app"] + "-"):
        raise ValueError("Database container must belong to the selected application")
    for key in ("transcripts", "destination"):
        path = Path(config[key])
        if not path.is_absolute() or path.is_symlink():
            raise ValueError("Backup paths must be absolute real directories")
    if Path(config["destination"]).resolve().is_relative_to(Path(config["transcripts"]).resolve()):
        raise ValueError("Backups cannot be placed inside the live transcript directory")


def copy_logs(source, destination):
    """Copy only the initial durable extent; incomplete crash tails remain private recovery evidence."""
    destination.mkdir(mode=0o700)
    manifest = {}
    for current, directories, files in os.walk(source, followlinks=False):
        directories[:] = [name for name in directories if not (Path(current) / name).is_symlink()]
        relative = Path(current).relative_to(source)
        target = destination / relative
        target.mkdir(mode=0o700, exist_ok=True)
        for name in files:
            original = Path(current) / name
            if original.is_symlink() or not original.is_file() or name.endswith(".tmp"):
                continue
            try:
                descriptor = os.open(original, os.O_RDONLY | os.O_NOFOLLOW)
            except FileNotFoundError:
                continue  # Retention may remove an old day after the database snapshot.
            digest = hashlib.sha256()
            with os.fdopen(descriptor, "rb") as incoming, (target / name).open("wb") as outgoing:
                remaining = os.fstat(incoming.fileno()).st_size
                size = remaining
                while remaining:
                    data = incoming.read(min(remaining, 1024 * 1024))
                    if not data:
                        raise RuntimeError("Transcript file shortened during backup")
                    outgoing.write(data)
                    digest.update(data)
                    remaining -= len(data)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            manifest[str(relative / name)] = {"bytes": size, "sha256": digest.hexdigest()}
    return manifest


def restore_check(config, backup, image):
    name = "caitlyn-backup-verify-" + uuid.uuid4().hex[:12]
    started = False
    try:
        run(["docker", "run", "-d", "--name", name, "--label", "caitlyn.task=backup-restore-verification",
             "--network", "none", "--memory", "1g", "--cpus", "1", "--tmpfs", "/var/lib/postgresql/data:rw,size=1g",
             "-e", "POSTGRES_HOST_AUTH_METHOD=trust", image], stdout=subprocess.DEVNULL)
        started = True
        for _ in range(60):
            ready = subprocess.run(["docker", "exec", name, "pg_isready", "-U", "postgres"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Restore database did not become ready")
        run(["docker", "exec", name, "createdb", "-U", "postgres", "verification"], stdout=subprocess.DEVNULL)
        with (backup / "database.dump").open("rb") as data:
            run(["docker", "exec", "-i", name, "pg_restore", "-U", "postgres", "-d", "verification",
                 "--no-owner", "--no-privileges", "--exit-on-error"], stdin=data, stdout=subprocess.DEVNULL)
        query = """SELECT json_build_object(
          'events', (SELECT count(*) FROM discord.transcript_events),
          'row_security', (SELECT relrowsecurity FROM pg_class WHERE oid='discord.transcript_events'::regclass),
          'policy', (SELECT count(*) FROM pg_policies WHERE schemaname='discord' AND tablename='transcript_events'),
          'checkpoints', (SELECT coalesce(json_agg(json_build_object('source',source,'offset',byte_offset)), '[]')
                         FROM discord.transcript_import_offsets))"""
        result = json.loads(run(["docker", "exec", name, "psql", "-U", "postgres", "-d", "verification", "-Atqc", query],
                                stdout=subprocess.PIPE, text=True).stdout)
        if result["row_security"] is not True or result["policy"] < 1:
            raise RuntimeError("Restored participant security is missing")
        missing = 0
        for checkpoint in result.pop("checkpoints"):
            source = Path(checkpoint["source"])
            if source.is_absolute() or ".." in source.parts:
                raise RuntimeError("Invalid restored checkpoint")
            file = backup / "transcripts" / source
            if file.exists() and file.stat().st_size < checkpoint["offset"]:
                raise RuntimeError("Backup file is behind its database checkpoint")
            if not file.exists():
                missing += 1  # Expired files can retain harmless replay checkpoints.
        result["absent_expired_files"] = missing
        return result
    finally:
        if started:
            run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL)


def backup(config):
    validate(config)
    source = Path(config["transcripts"])
    owner = (source.stat().st_uid, source.stat().st_gid)
    root = Path(config["destination"])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / ".backup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        destination = root / (datetime.now(timezone.utc).strftime("scheduled-%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:6])
        destination.mkdir(mode=0o700)
        try:
            from truenas_api_client import Client
            with Client(call_timeout=30) as client:
                compose = client.call("app.config", config["app"])
            private_json(destination / "truenas-app-config.json", compose)
            for index, filename in enumerate(config.get("privateFiles", [])):
                source_file = Path(filename)
                if not source_file.is_absolute() or source_file.is_symlink():
                    raise ValueError("Invalid private configuration path")
                with (destination / ("private-config-" + str(index))).open("wb") as output:
                    output.write(source_file.read_bytes())
                    output.flush()
                    os.fsync(output.fileno())
            image = run(["docker", "inspect", "--format", "{{.Image}}", config["container"]], stdout=subprocess.PIPE, text=True).stdout.strip()
            with (destination / "database.dump").open("wb") as output:
                run(["docker", "exec", config["container"], "pg_dump", "-U", config["role"], "-d", config["database"], "-Fc"], stdout=output)
                output.flush()
                os.fsync(output.fileno())
            files = copy_logs(source, destination / "transcripts")
            verification = restore_check(config, destination, image)
            result = {"version": 1, "completedAt": int(time.time() * 1000), "app": config["app"], "databaseImage": image,
                      "files": files, "privateFiles": config.get("privateFiles", []), "restore": verification, "restoreVerified": True}
            private_json(destination / "manifest.json", result)
            private_json(source / "backup-status.json", {"completedAt": result["completedAt"], "restoreVerified": True, "failed": False}, owner)
            return {"completed": True, "files": len(files), "restored_events": verification["events"]}
        except Exception:
            # No captured exception text: pg_dump errors can contain private database values.
            private_json(source / "backup-status.json", {"checkedAt": int(time.time() * 1000), "failed": True}, owner)
            raise RuntimeError("Private backup or restore verification failed; inspect the protected backup directory") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="Private JSON backup configuration")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(backup(json.loads(args.config.read_text()))))
    except Exception:
        print(json.dumps({"completed": False, "reason": "Backup failed; private details withheld"}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
