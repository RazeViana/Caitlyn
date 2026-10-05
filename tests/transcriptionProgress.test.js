/**
 * @file transcriptionProgress.test.js
 * @description Checks private queue snapshots, completion, expiry and telemetry failure isolation.
 * @module transcriptionProgress.test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TranscriptionQueue } from "../core/transcriptionQueue.ts";
import { TranscriptionProgress } from "../core/transcriptionProgress.ts";

const record = { eventId: "speech-1", guildId: "123", channelId: "456", channelName: "Lounge", sessionId: "session-1",
	type: "transcript", userId: "111", speaker: "Alex", at: "2026-10-05T12:00:00Z", end: "2026-10-05T12:00:02Z",
	audienceVersion: 1, audienceUserIds: ["111", "222"] };
const chunk = { pcm: Buffer.from("private audio"), at: Date.parse(record.at), end: Date.parse(record.end) };

test("queue progress preserves capture audience, omits content and clears completed, silent and failed speech", async () => {
	let complete;
	let calls = 0;
	const saved = [];
	const queue = new TranscriptionQueue(async () => {
		if (++calls === 1) return new Promise((resolve) => { complete = resolve; });
		if (calls === 2) return "";
		throw new Error("Failed");
	}, async (value) => { saved.push(value); }, () => assert.fail("Unexpected storage failure"));
	queue.push(chunk, record);
	queue.push(chunk, { ...record, eventId: "speech-2", audienceUserIds: ["111"] });
	queue.push(chunk, { ...record, eventId: "speech-3", audienceUserIds: [] });
	const snapshot = queue.activity();
	assert.deepEqual(snapshot.map((item) => [item.eventId, item.phase]), [["speech-1", "transcribing"], ["speech-2", "queued"]]);
	assert.equal(JSON.stringify(snapshot).includes("private audio"), false);
	assert.equal("text" in snapshot[0], false);
	snapshot[0].audienceUserIds.push("999");
	assert.deepEqual(queue.activity()[0].audienceUserIds, ["111", "222"]);
	complete("Finished words");
	await queue.drain();
	assert.deepEqual(queue.activity(), []);
	assert.deepEqual(saved.map((item) => item.type), ["transcript", "gap"]);
	await queue.stop();
});

test("progress heartbeat is private, bounded, short-lived and cleared on stop", async () => {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-progress-"));
	let now = 1_000_000;
	const item = { ...record, phase: "transcribing" };
	const worker = new TranscriptionProgress(directory, "123", () => [item, { ...item, guildId: "999" }], () => assert.fail("Unexpected failure"), () => now);
	const path = join(directory, "assets", "123", "progress.json");
	const read = async () => JSON.parse(await readFile(path, "utf8"));
	try {
		await worker.start();
		assert.equal((await stat(path)).mode & 0o777, 0o600);
		const first = await read();
		assert.equal(first.jobs.length, 1);
		assert.equal(first.expiresAt - first.updatedAt, 8000);
		now += 2000;
		await worker.refresh();
		assert.equal((await read()).updatedAt, now);
		await worker.stop();
		assert.deepEqual((await read()).jobs, []);
		assert.equal((await read()).expiresAt, now);
		now += 2000;
		await worker.refresh();
		assert.notEqual((await read()).updatedAt, now);
	}
	finally { await worker.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("an unwritable progress export cannot reject capture startup or shutdown", async () => {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-progress-failure-"));
	await writeFile(join(directory, "assets"), "not a directory");
	let warnings = 0;
	const worker = new TranscriptionProgress(directory, "123", () => [], () => { warnings++; });
	try {
		await worker.start();
		await worker.refresh();
		assert.equal(warnings, 1);
		await worker.stop();
	}
	finally { await worker.stop(); await rm(directory, { recursive: true, force: true }); }
});
