# @file deploymentUpdater_test.py
# @description Tests release selection, private files, stopped-app protection and rollback using fake operations.
# @module deploymentUpdater_test

import copy
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("updater", Path(__file__).resolve().parents[1] / "scripts/deployment/autoUpdate.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
REVISION = "a" * 40
OLD = "b" * 40
CONFIG = {"repository": "Fixture/Caitlyn", "app": "caitlyn", "runtimeRoot": "/mnt/pool/private", "approvedMigrationHash": "c" * 64, "enabled": True}
MANIFEST = {"version": 1, "repository": CONFIG["repository"], "revision": REVISION, "platform": "linux/amd64", "migrationHash": CONFIG["approvedMigrationHash"],
            "inventoryHash": "d" * 64, "images": {role: "ghcr.io/fixture/caitlyn" + ("" if role == "bot" else "-" + role) + "@sha256:" + "e" * 64 for role in ("bot", "broker", "fxembed", "media")}}
COMPOSE = {"services": {name: {"image": "sha256:" + "f" * 64, "read_only": True, "pull_policy": "never", "environment": {}, "volumes": ["keep"]}
                        for name in ("caitlyn", "broker", "fxembed")}}


class FakeOperations:
    def __init__(self):
        self.events = []
        self.saved = []
        self.status = "RUNNING"
        self.idle = True
        self.fail = None
        self.current_calls = 0
        self.change_on_download = False

    def current(self):
        self.current_calls += 1
        return ("STOPPED" if self.change_on_download and self.current_calls > 1 else self.status), copy.deepcopy(COMPOSE)

    def worker_idle(self):
        return self.idle

    def resources_clean(self):
        self.events.append("clean")

    def pull(self, manifest):
        self.events.append("pull-all")
        if self.fail == "pull":
            raise updater.UpdateError("pull_failed")
        return {role: "sha256:" + "1" * 64 for role in manifest["images"]}

    def preflight(self, image):
        self.events.append("preflight")
        if self.fail == "preflight":
            raise updater.UpdateError("preflight_failed")

    def archive(self, *args):
        self.events.append("archive")

    def save(self, state):
        self.saved.append(copy.deepcopy(state))

    def replace(self, compose):
        self.events.append("rollback" if compose == COMPOSE else "replace")
        if self.fail == "uncertain":
            raise updater.UncertainUpdate("job_still_running")

    def verify(self, compose):
        self.events.append("verify-old" if compose == COMPOSE else "verify-new")
        if self.fail == "startup" and compose != COMPOSE:
            raise updater.UpdateError("startup_failed")

    def commands(self):
        self.events.append("commands")
        if self.fail == "commands" and "rollback" not in self.events:
            raise updater.UpdateError("commands_failed")


class UpdaterTests(unittest.TestCase):
    def apply(self, operations, state=None, manifest=None):
        return updater.apply_release(manifest or copy.deepcopy(MANIFEST), {}, CONFIG, state or {"phase": "idle", "revision": OLD}, operations)

    def test_complete_set_is_pulled_and_checked_before_replacing(self):
        operations = FakeOperations()
        self.assertEqual(self.apply(operations), "updated")
        self.assertLess(operations.events.index("pull-all"), operations.events.index("replace"))
        self.assertLess(operations.events.index("preflight"), operations.events.index("replace"))
        self.assertLess(operations.events.index("verify-new"), operations.events.index("commands"))
        self.assertEqual(operations.saved[-1]["revision"], REVISION)
        self.assertEqual(operations.saved[0]["previousCompose"], COMPOSE)

    def test_failed_download_does_not_stop_running_app(self):
        operations = FakeOperations()
        operations.fail = "pull"
        with self.assertRaises(updater.UpdateError):
            self.apply(operations)
        self.assertNotIn("replace", operations.events)
        self.assertEqual(operations.saved, [])

    def test_failed_database_check_does_not_stop_app(self):
        operations = FakeOperations()
        operations.fail = "preflight"
        with self.assertRaises(updater.UpdateError):
            self.apply(operations)
        self.assertNotIn("replace", operations.events)

    def test_stopped_app_is_not_started(self):
        operations = FakeOperations()
        operations.status = "STOPPED"
        self.assertEqual(self.apply(operations), "deferred")
        self.assertEqual(operations.events, [])

    def test_busy_worker_defers_update(self):
        operations = FakeOperations()
        operations.idle = False
        self.assertEqual(self.apply(operations), "busy")
        self.assertEqual(operations.events, [])

    def test_operator_change_during_download_stops_update(self):
        operations = FakeOperations()
        operations.change_on_download = True
        with self.assertRaisesRegex(updater.UpdateError, "app_changed"):
            self.apply(operations)
        self.assertNotIn("replace", operations.events)

    def test_failed_startup_restores_old_services_and_commands(self):
        operations = FakeOperations()
        operations.fail = "startup"
        self.assertEqual(self.apply(operations), "rolled_back")
        self.assertIn("verify-old", operations.events)
        self.assertEqual(operations.saved[-1]["revision"], OLD)
        self.assertEqual(operations.saved[-1]["blockedRevision"], REVISION)

    def test_failed_registration_also_rolls_back(self):
        operations = FakeOperations()
        operations.fail = "commands"
        self.assertEqual(self.apply(operations), "rolled_back")
        self.assertEqual(operations.events.count("commands"), 2)

    def test_unknown_job_result_never_races_with_rollback(self):
        operations = FakeOperations()
        operations.fail = "uncertain"
        with self.assertRaises(updater.UncertainUpdate):
            self.apply(operations)
        self.assertNotIn("rollback", operations.events)
        self.assertEqual(operations.saved[-1]["phase"], "updating")

    def test_failed_or_already_installed_release_not_retried(self):
        for key in ("revision", "blockedRevision"):
            operations = FakeOperations()
            self.assertEqual(self.apply(operations, {"phase": "idle", key: REVISION}), "unchanged")
            self.assertEqual(operations.events, [])

    def test_interrupted_update_requires_review(self):
        with self.assertRaisesRegex(updater.UpdateError, "unfinished"):
            self.apply(FakeOperations(), {"phase": "updating"})

    def test_migration_change_never_reaches_app_operations(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest["migrationHash"] = "9" * 64
        operations = FakeOperations()
        with self.assertRaisesRegex(updater.UpdateError, "database_changes"):
            self.apply(operations, manifest=manifest)
        self.assertEqual(operations.events, [])

    def test_manifest_rejects_foreign_repositories_tags_and_partial_sets(self):
        for value in ("ghcr.io/other/caitlyn@sha256:" + "e" * 64, "ghcr.io/fixture/caitlyn:latest", "-malicious-option"):
            manifest = copy.deepcopy(MANIFEST)
            manifest["images"]["bot"] = value
            with self.assertRaises(updater.UpdateError):
                updater.validate_manifest(manifest, CONFIG)
        manifest = copy.deepcopy(MANIFEST)
        del manifest["images"]["broker"]
        with self.assertRaises(updater.UpdateError):
            updater.validate_manifest(manifest, CONFIG)

    def test_compose_changes_only_images_and_preserves_mounts(self):
        images = {name: "sha256:" + "1" * 64 for name in MANIFEST["images"]}
        result = updater.candidate_compose(COMPOSE, images)
        self.assertEqual(result["services"]["caitlyn"]["volumes"], ["keep"])
        self.assertEqual(result["services"]["broker"]["environment"]["SOCIAL_WORKER_IMAGE"], images["media"])
        self.assertNotEqual(result["services"]["caitlyn"]["image"], COMPOSE["services"]["caitlyn"]["image"])
        changed = copy.deepcopy(COMPOSE)
        changed["services"]["watchtower"] = {}
        with self.assertRaises(updater.UpdateError):
            updater.candidate_compose(changed, images)

    def test_private_configuration_rejects_symlinks_and_world_readable_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "config.json"
            updater.save_private(path, CONFIG)
            self.assertEqual(updater.read_private(path), CONFIG)
            link = Path(temporary) / "link.json"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                updater.read_private(link)
            path.chmod(0o644)
            with self.assertRaises(updater.UpdateError):
                updater.read_private(path)

    def test_missing_release_is_a_quiet_noop(self):
        with patch.object(updater, "download", return_value=None):
            self.assertIsNone(updater.latest_release(CONFIG))

    def test_old_release_waits_for_current_main_build(self):
        release = {"tag_name": "main-" + REVISION, "target_commitish": REVISION, "assets": []}
        with patch.object(updater, "download", side_effect=[json.dumps(release).encode(), json.dumps({"commit": {"sha": OLD}}).encode()]):
            self.assertIsNone(updater.latest_release(CONFIG))

    def test_complete_release_assets_and_inventory_hash_are_bound_to_main(self):
        inventory = {"revision": REVISION, "images": {role: {"image": image, "osPackages": ["fixture-1"], "npmPackages": [{"name": "fixture", "version": "1"}]}
                                                    for role, image in MANIFEST["images"].items()}}
        data = json.dumps(inventory).encode()
        manifest = {**MANIFEST, "inventoryHash": hashlib.sha256(data).hexdigest()}
        release = {"tag_name": "main-" + REVISION, "target_commitish": REVISION,
                   "assets": [{"name": name, "browser_download_url": "https://github.com/Fixture/Caitlyn/releases/download/main-" + REVISION + "/" + name}
                              for name in ("caitlyn-release.json", "caitlyn-installations.json")]}
        downloads = [json.dumps(release).encode(), json.dumps({"commit": {"sha": REVISION}}).encode(), json.dumps(manifest).encode(), data]
        with patch.object(updater, "download", side_effect=downloads):
            self.assertEqual(updater.latest_release(CONFIG), (manifest, inventory))
        downloads[-1] = b"changed package inventory"
        with patch.object(updater, "download", side_effect=downloads):
            with self.assertRaisesRegex(updater.UpdateError, "package_inventory_mismatch"):
                updater.latest_release(CONFIG)
        release["assets"][0]["browser_download_url"] = "http://127.0.0.1/private"
        with patch.object(updater, "download", side_effect=[json.dumps(release).encode(), downloads[1]]):
            with self.assertRaisesRegex(updater.UpdateError, "release_asset"):
                updater.latest_release(CONFIG)

    def test_missing_or_pending_job_result_is_not_treated_as_failure_safe_to_rollback(self):
        operations = updater.Operations(CONFIG, Path("/fixture"))
        with patch.object(operations, "api", side_effect=updater.UpdateError("command_timeout")):
            with self.assertRaises(updater.UncertainUpdate):
                operations.job("app.start", "caitlyn")
        with patch.object(operations, "api", side_effect=[123, [{"state": "FAILED"}]]):
            with self.assertRaises(updater.UpdateError) as result:
                operations.job("app.start", "caitlyn")
            self.assertNotIsInstance(result.exception, updater.UncertainUpdate)

    def test_rollback_restarts_an_already_stopped_app_without_stopping_it_twice(self):
        operations = updater.Operations(CONFIG, Path("/fixture"))
        with patch.object(operations, "current", return_value=("STOPPED", COMPOSE)), patch.object(operations, "job") as jobs:
            operations.replace(COMPOSE)
            self.assertEqual([call.args[0] for call in jobs.call_args_list], ["app.update", "app.start"])


if __name__ == "__main__":
    unittest.main()
