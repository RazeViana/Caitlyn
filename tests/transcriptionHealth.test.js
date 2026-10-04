/**
 * @file transcriptionHealth.test.js
 * @description Checks dependency failure alerts, recovery, durable lost-segment counts and stale backup monitoring without live services.
 * @module transcriptionHealth.test
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TranscriptionHealth } from "../core/transcriptionHealth.ts";

test("health checks alert once per condition, recover and persist aggregate loss without transcript content", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-health-"));
	context.after(() => rm(directory, { force: true, recursive: true }));
	let now = Date.now();
	const logs = [];
	const state = { discordReady: true, paused: false, recording: true, storageHealthy: true, pending: 0, lost: 0,
		lastPacketAt: 0, lastSavedAt: 0, archive: { state: "synced", stalled: false, quarantined: 0 } };
	let worker = false;
	let disk = 500;
	const dependencies = { now: () => now, fetch: async () => new Response(JSON.stringify({ ready: worker })),
		statfs: async () => ({ bavail: disk, bsize: 1024 ** 2 }),
		log: Object.fromEntries(["warn", "success", "debug"].map((level) => [level, (...args) => logs.push({ level, text: args.join(" ") })])) };
	const health = new TranscriptionHealth(directory, "123", "http://worker:8095/transcribe", () => state, true, dependencies);
	await health.check();
	assert.equal(logs.filter((r) => r.level === "warn").length, 3);
	await health.check();
	assert.equal(logs.filter((r) => r.level === "warn").length, 3);
	worker = true;
	disk = 2000;
	await writeFile(join(directory, "backup-status.json"), JSON.stringify({ completedAt: now, restoreVerified: true, failed: false }));
	state.lost = 2;
	await health.check();
	assert.equal(health.summary, "healthy");
	assert.equal(JSON.parse(await readFile(join(directory, "health.json"), "utf8")).lifetimeLost, 2);
	state.lost = 0;
	const restarted = new TranscriptionHealth(directory, "123", "http://worker:8095/transcribe", () => state, true, dependencies);
	await restarted.start();
	state.lost = 1;
	await restarted.check();
	assert.equal(JSON.parse(await readFile(join(directory, "health.json"), "utf8")).lifetimeLost, 3);
	now += 37 * 3_600_000;
	await restarted.check();
	assert.match(restarted.summary, /backup/);
	await restarted.stop();
});
