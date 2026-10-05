/**
 * @file transcription.test.js
 * @description Exercises local-only configuration, private daily speech/activity files, continuous audio boundaries and bounded inference.
 * @module transcription.test
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import OpusScript from "opusscript";
import { localTranscriptionEndpoint, transcriptionSettings } from "../core/transcriptionConfig.ts";
import { SpeakerBuffer, localTranscriber, waveAudio, MAX_AUDIO_BYTES } from "../core/transcriptionAudio.ts";
import { TranscriptionStore, transcriptDay } from "../core/transcriptionStore.ts";
import { TranscriptionQueue } from "../core/transcriptionQueue.ts";

const settings = { GUILD_ID: "123", TRANSCRIPTION_DIRECTORY: "/private/transcripts", TRANSCRIPTION_ENDPOINT: "http://transcription:8095/transcribe", TRANSCRIPTION_CHANNEL_IDS: "*" };
const record = { type: "transcript", at: "2026-10-01T21:59:59.000Z", guildId: "123", channelId: "456", channelName: "General", sessionId: "session", userId: "789", speaker: "Someone", text: "Hello" };

test("transcription defaults off, requires local storage/service and never accepts a public provider", () => {
	assert.equal(transcriptionSettings(settings).enabled, false);
	const configured = transcriptionSettings({ ...settings, TRANSCRIPTION_ENABLED: "true" });
	assert.equal(configured.enabled, true);
	assert.equal(configured.config.language, "en");
	assert.equal(configured.config.timezone, "Europe/Amsterdam");
	for (const endpoint of ["https://api.example.com/transcribe", "http://8.8.8.8", "http://host.example.com", "http://user:secret@localhost", "http://localhost?token=secret", "file:///tmp/model"]) assert.equal(localTranscriptionEndpoint(endpoint), false, endpoint);
	for (const endpoint of ["http://127.0.0.1:8095/transcribe", "http://192.168.2.43:8095", "http://172.18.0.2", "http://[::1]", "http://transcription:8095"]) assert.equal(localTranscriptionEndpoint(endpoint), true, endpoint);
	for (const invalid of [{ TRANSCRIPTION_DIRECTORY: "relative" }, { TRANSCRIPTION_CHANNEL_IDS: "*,123" }, { TRANSCRIPTION_CHANNEL_IDS: "" }, { TRANSCRIPTION_TIMEZONE: "invalid/time" }, { TRANSCRIPTION_LANGUAGE: "../../en" }]) {
		assert.equal(transcriptionSettings({ ...settings, TRANSCRIPTION_ENABLED: "true", ...invalid }).enabled, false);
	}
});

test("daily logs use capture date across midnight/DST and preserve speaker IDs with private permissions", async (context) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-transcripts-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const store = new TranscriptionStore(directory, "Europe/Amsterdam");
	await store.initialize();
	assert.equal(await store.paused(), false);
	await store.setPaused(true);
	assert.equal(await new TranscriptionStore(directory, "Europe/Amsterdam").paused(), true);
	await Promise.all([store.append(record), store.append({ ...record, at: "2026-10-01T22:00:00.000Z", userId: "999", speaker: "Name\nspoof", text: "Line one\nline two" })]);
	const first = path.join(directory, "123/456/2026-10-01.jsonl");
	const second = path.join(directory, "123/456/2026-10-02.jsonl");
	assert.equal(JSON.parse(await readFile(first, "utf8")).userId, "789");
	assert.equal(JSON.parse(await readFile(second, "utf8")).userId, "999");
	assert.equal((await stat(first)).mode & 0o777, 0o600);
	assert.equal((await stat(path.dirname(first))).mode & 0o777, 0o700);
	const text = await readFile(second.replace(".jsonl", ".txt"), "utf8");
	assert.match(text, /00:00:00.*GMT\+2.*Name spoof \(999\): Line one line two/);
	assert.equal(text.trim().split("\n").length, 1);
	assert.equal(transcriptDay("2026-10-25T01:30:00Z", "Europe/Amsterdam"), "2026-10-25");
	await assert.rejects(store.append({ ...record, channelId: "../elsewhere" }), /identity/);
});

test("daily activity logs name voice and post channels while preserving full message text in JSONL", async (context) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-activity-transcripts-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const store = new TranscriptionStore(directory, "Europe/Amsterdam");
	await store.initialize();
	for (const type of ["present", "joined", "left"]) await store.append({ ...record, type, text: undefined });
	const message = { ...record, type: "message_posted", activityChannelId: "900", activityChannelName: "discussion\nspoof",
		activityParentChannelId: "899", activityParentChannelName: "forum", messageId: "901", messageUrl: "https://discord.com/channels/123/900/901",
		attachmentNames: ["file\nname.png"], text: "First line\nSecond line\u2028@everyone" };
	await store.append(message);
	const base = path.join(directory, "123/456/2026-10-01");
	const records = (await readFile(`${base}.jsonl`, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(records[3].text, message.text);
	assert.deepEqual(records[3].attachmentNames, message.attachmentNames);
	assert.equal(records[3].activityChannelId, "900");
	const lines = (await readFile(`${base}.txt`, "utf8")).trim().split("\n");
	assert.equal(lines.length, 4);
	assert.match(lines[0], /\[present\] Present in voice channel "General" \(456\)/);
	assert.match(lines[1], /\[joined\] Joined voice channel "General" \(456\)/);
	assert.match(lines[2], /\[left\] Left voice channel "General" \(456\)/);
	assert.match(lines[3], /Someone \(789\): \[message_posted\] Posted in #forum \/ #discussion spoof \(900\)/);
	assert.ok(lines[3].includes(message.messageUrl));
	assert.match(lines[3], /Message: First line Second line @everyone \| Attachments: file name.png/);
	assert.equal((await stat(`${base}.txt`)).mode & 0o777, 0o600);
});

test("unclean restart records an operator-only gap without inventing participant attendance", async (context) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-restart-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const store = new TranscriptionStore(directory, "Europe/Amsterdam");
	await store.initialize();
	await store.markSession({ ...record, audienceVersion: 1, audienceUserIds: ["789"] });
	const restarted = new TranscriptionStore(directory, "Europe/Amsterdam");
	assert.equal(await restarted.recoverSession("123"), true);
	const file = path.join(directory, "123", "456", transcriptDay(Date.now(), "Europe/Amsterdam") + ".jsonl");
	const gap = JSON.parse(await readFile(file, "utf8"));
	assert.equal(gap.type, "gap");
	assert.equal(gap.sessionId, "session");
	assert.deepEqual(gap.audienceUserIds, []);
	assert.equal(gap.userId, undefined);
	assert.equal(await restarted.recoverSession("123"), false);
});

test("continuous speech is bounded without losing frames, with silence and midnight boundaries", () => {
	const chunks = [];
	const buffer = new SpeakerBuffer("Europe/Amsterdam", (chunk) => chunks.push(chunk));
	const begin = Date.parse("2026-10-01T10:00:00Z");
	for (let frame = 0; frame < 2500; frame++) buffer.push(Buffer.alloc(640, frame % 255), begin + frame * 20);
	buffer.idle(begin + 51_000);
	assert.equal(chunks.length, 3);
	assert.equal(chunks.reduce((sum, chunk) => sum + chunk.pcm.length, 0), 2500 * 640);
	assert.ok(chunks.every((chunk) => chunk.pcm.length <= MAX_AUDIO_BYTES));
	const boundary = Date.parse("2026-10-01T22:00:00Z");
	buffer.push(Buffer.alloc(640), boundary - 20);
	buffer.push(Buffer.alloc(640), boundary);
	buffer.flush();
	assert.equal(transcriptDay(chunks.at(-2).at, "Europe/Amsterdam"), "2026-10-01");
	assert.equal(transcriptDay(chunks.at(-1).at, "Europe/Amsterdam"), "2026-10-02");
});

test("WAV and real Opus decoder produce worker-compatible mono 16 kHz audio", () => {
	const encoder = new OpusScript(48000, 2, OpusScript.Application.VOIP);
	const decoder = new OpusScript(16000, 1, OpusScript.Application.VOIP);
	try {
		const pcm = decoder.decode(encoder.encode(Buffer.alloc(960 * 2 * 2), 960));
		assert.equal(pcm.length, 640);
		const wav = waveAudio(pcm);
		assert.equal(wav.toString("ascii", 0, 4), "RIFF");
		assert.equal(wav.readUInt16LE(22), 1);
		assert.equal(wav.readUInt32LE(24), 16000);
		assert.equal(wav.readUInt32LE(40), pcm.length);
	}
	finally { encoder.delete(); decoder.delete(); }
});

test("local worker client passes WAV without credentials, forbids redirects and bounds responses", async () => {
	const config = transcriptionSettings(settings).config;
	const transcribe = localTranscriber(config, async (url, options) => {
		assert.equal(url.hostname, "transcription");
		assert.equal(url.searchParams.get("language"), "en");
		assert.equal(options.redirect, "error");
		assert.deepEqual(options.headers, { "Content-Type": "audio/wav" });
		assert.equal(Buffer.from(options.body).toString("ascii", 0, 4), "RIFF");
		return new Response(JSON.stringify({ text: " spoken words " }));
	});
	assert.equal(await transcribe(Buffer.alloc(640), new AbortController().signal), "spoken words");
	for (const response of [new Response("private failure", { status: 500 }), new Response("x".repeat(65_000)), new Response("{}")]) {
		await assert.rejects(localTranscriber(config, async () => response)(Buffer.alloc(640), new AbortController().signal), (error) => !error.message.includes("private failure"));
	}
});

test("inference preserves overlapping speaker identities, logs failures and bounds backlog", async () => {
	let release;
	const held = new Promise((resolve) => { release = resolve; });
	const records = [];
	let calls = 0;
	const queue = new TranscriptionQueue(async () => {
		if (++calls === 1) await held;
		if (calls === 2) throw new Error("private provider detail");
		return "speech";
	}, async (entry) => { records.push(entry); }, () => assert.fail("storage failure"), 2);
	const chunk = { pcm: Buffer.alloc(640), at: 1, end: 2 };
	queue.push(chunk, record);
	queue.push(chunk, { ...record, userId: "999" });
	queue.push(chunk, record);
	queue.push(chunk, record);
	assert.equal(queue.pending, 3);
	release();
	await queue.drain();
	assert.equal(records[0].userId, "789");
	assert.match(records.find((entry) => entry.userId === "999").text, /recognition failed/);
	assert.ok(records.some((entry) => entry.type === "gap" && /queue full/.test(entry.text)));
	assert.ok(!JSON.stringify(records).includes("private provider detail"));
});

test("combined overload gaps cannot grant access across an unproven absence interval", async () => {
	let release;
	const held = new Promise((resolve) => { release = resolve; });
	const records = [];
	const queue = new TranscriptionQueue(async () => {
		await held;
		return "speech";
	},
	async (entry) => { records.push(entry); }, () => assert.fail("storage failure"), 1);
	const chunk = { pcm: Buffer.alloc(640), at: 1, end: 2 };
	const visible = { ...record, audienceVersion: 1, audienceUserIds: ["789"] };
	queue.push(chunk, visible);
	queue.push(chunk, visible);
	queue.push(chunk, visible);
	queue.push(chunk, { ...visible, at: "2026-10-02T01:00:00Z" });
	release();
	await queue.drain();
	assert.deepEqual(records.find((entry) => entry.type === "gap").audienceUserIds, []);
	assert.ok(records.filter((entry) => entry.type === "transcript").every((entry) => entry.audienceUserIds.includes("789")));
});

test("shutdown cancels inference and records discarded pending audio; storage failure stops the queue", async () => {
	const records = [];
	const queue = new TranscriptionQueue(async (_pcm, signal) => new Promise((_resolve, reject) => {
		signal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
	}), async (entry) => { records.push(entry); }, () => assert.fail("storage failure"));
	const chunk = { pcm: Buffer.alloc(640), at: 1, end: 2 };
	queue.push(chunk, record);
	queue.push(chunk, record);
	await queue.stop(10);
	assert.equal(records.length, 2);
	assert.ok(records.every((entry) => entry.type === "gap" && /Shutdown/.test(entry.text)));
	let failed = false;
	const broken = new TranscriptionQueue(async () => "speech",
		async () => { throw new Error("disk full"); },
		() => { failed = true; });
	broken.push(chunk, record);
	await broken.drain();
	assert.equal(failed, true);
	assert.equal(broken.healthy, false);
});
