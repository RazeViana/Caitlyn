"""@file transcriptionBackup.test.py
@description Verifies private file backup boundaries without touching Docker, PostgreSQL or TrueNAS.
@module transcription_backup_test
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import subprocess
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("backup", Path(__file__).parents[1] / "scripts/transcription/backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_copy_preserves_initial_bytes_and_private_permissions_without_following_links(self):
        old_mask = os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory() as root:
                path = Path(root)
                source = path / "live"
                source.mkdir()
                (source / "123").mkdir()
                raw = b'{"version":1}\n{"partial":'
                (source / "123/day.jsonl").write_bytes(raw)
                (source / "ignore.tmp").write_text("temporary")
                (source / "link").symlink_to("/etc/passwd")
                manifest = backup.copy_logs(source, path / "copy")
                self.assertEqual(set(manifest), {"123/day.jsonl"})
                self.assertEqual(manifest["123/day.jsonl"]["sha256"], hashlib.sha256(raw).hexdigest())
                self.assertEqual((path / "copy/123/day.jsonl").read_bytes(), raw)
                self.assertEqual((path / "copy/123/day.jsonl").stat().st_mode & 0o777, 0o600)
        finally:
            os.umask(old_mask)

    def test_config_rejects_wrong_application_and_recursive_backup_locations(self):
        config = {"app": "caitlyn-test", "role": "caitlyn_test", "database": "caitlyn_test",
                  "container": "ix-caitlyn-test-database-1", "transcripts": "/tmp/voice", "destination": "/tmp/backups"}
        backup.validate(config)
        for changes in ({"container": "ix-unrelated-db-1"}, {"destination": "/tmp/voice/backups"}, {"role": "bad;command"}):
            with self.assertRaises(ValueError):
                backup.validate({**config, **changes})

    def test_status_write_does_not_follow_a_predictable_temporary_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)
            protected = path / "unrelated"
            protected.write_text("unchanged")
            (path / "status.json.tmp").symlink_to(protected)
            backup.private_json(path / "status.json", {"complete": True})
            self.assertEqual(protected.read_text(), "unchanged")
            self.assertEqual((path / "status.json").stat().st_mode & 0o777, 0o600)

    def test_restore_waits_past_the_temporary_unix_socket_startup_server(self):
        polls = 0
        initializing = True

        def docker(arguments, **_kwargs):
            nonlocal polls, initializing
            if "pg_isready" in arguments:
                if "-h" not in arguments:
                    return SimpleNamespace(returncode=0)
                polls += 1
                initializing = polls < 3
                return SimpleNamespace(returncode=2 if initializing else 0)
            if "createdb" in arguments and initializing:
                raise subprocess.CalledProcessError(1, arguments, stderr=b"temporary server stopped")
            return SimpleNamespace(returncode=0, stdout='{"events":36,"row_security":true,"policy":1,"checkpoints":[]}')

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            (destination / "database.dump").write_bytes(b"fixture")
            with mock.patch.object(backup.subprocess, "run", side_effect=docker), mock.patch.object(backup.time, "sleep"):
                result = backup.restore_check({}, destination, "test-image")
            self.assertEqual(polls, 3)
            self.assertEqual(result["events"], 36)


if __name__ == "__main__":
    unittest.main()
