/**
 * @file deploymentRelease.test.js
 * @description Checks immutable release references, database change detection and the offline server-updater suite.
 * Uses temporary files and fake services, with no GitHub, Docker, database or Discord access.
 *
 * @module deploymentRelease.test
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { migrationFingerprint, releaseImages } from "../scripts/deployment/releaseManifest.mjs";

test("release images require all four immutable digests and a fixed repository", () => {
	const digests = Object.fromEntries(["bot", "broker", "fxembed", "media"].map((name) => [name, "sha256:" + "a".repeat(64)]));
	const images = releaseImages("fixture/caitlyn", digests);
	assert.equal(images.bot, "ghcr.io/fixture/caitlyn@" + digests.bot);
	assert.equal(images.media, "ghcr.io/fixture/caitlyn-media@" + digests.media);
	assert.throws(() => releaseImages("fixture/caitlyn", { ...digests, broker: "latest" }));
	assert.throws(() => releaseImages("fixture/caitlyn;bad", digests));
});

test("database approval changes when a migration is added or edited, regardless of directory order", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-release-test-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(join(directory, "002_second.sql"), "SELECT 2;");
	await writeFile(join(directory, "001_first.sql"), "SELECT 1;");
	const original = await migrationFingerprint(directory);
	assert.equal(await migrationFingerprint(directory), original);
	await writeFile(join(directory, "002_second.sql"), "SELECT 3;");
	assert.notEqual(await migrationFingerprint(directory), original);
	await writeFile(join(directory, "002_second.sql"), "SELECT 2;");
	await writeFile(join(directory, "003_third.sql"), "SELECT 3;");
	assert.notEqual(await migrationFingerprint(directory), original);
});

test("mainframe updater passes its offline state, rollback and input-safety checks", async () => {
	const result = await promisify(execFile)("python3", ["-B", "tests/deploymentUpdater_test.py"], { timeout: 20_000, maxBuffer: 65_536 });
	assert.match(result.stderr, /OK/);
	assert.match(result.stderr, /Ran \d+ tests/);
});

test("CI publishes a complete release after four builds and inventories, never mutable latest tags", async () => {
	const workflow = await readFile(".github/workflows/ci.yml", "utf8");
	assert.match(workflow, /needs: check/);
	assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
	assert.match(workflow, /cancel-in-progress: false/);
	for (const role of ["bot", "broker", "fxembed", "media"]) assert.match(workflow, new RegExp(`steps\\.${role}\\.outputs\\.digest`));
	assert.ok(workflow.indexOf("gh release create") > workflow.indexOf("node scripts/deployment/releaseManifest.mjs"));
	assert.doesNotMatch(workflow, /tags:[^\n]*:latest/);
	assert.doesNotMatch(workflow, /--working-overlays/);
});
