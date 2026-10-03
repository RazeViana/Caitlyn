/**
 * @file transcriptionArchive.test.js
 * @description Verifies fail-closed audience validation and opt-in PostgreSQL replay, row security, searching and pooled viewer isolation.
 * @module transcriptionArchive.test
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { archivedEvent, TranscriptionArchive } from "../core/transcriptionArchive.ts";
import { TranscriptionStore } from "../core/transcriptionStore.ts";
import { createTranscriptionReader } from "../core/transcriptionReader.ts";

const base = {
	version: 1, timezone: "Europe/Amsterdam", type: "transcript", at: "2026-10-03T20:00:00.000Z",
	end: "2026-10-03T20:00:01.000Z", guildId: "123", channelId: "456", channelName: "Voice room",
	sessionId: "session-one", userId: "111", speaker: "alice_account", text: "Before Carol arrived",
};

test("archive validation never infers an audience from old membership logs or unsupported metadata", () => {
	const legacy = archivedEvent(base, "123/456/2026-10-03.jsonl", 0, "123", "456");
	assert.equal(legacy.audience_version, 0);
	assert.deepEqual(legacy.audience_user_ids, []);
	assert.equal(legacy.event_id, archivedEvent(base, "123/456/2026-10-03.jsonl", 0, "123", "456").event_id);
	assert.notEqual(legacy.event_id, archivedEvent(base, "123/456/2026-10-03.jsonl", 1, "123", "456").event_id);
	const unknown = archivedEvent({ ...base, audienceVersion: 2, audienceUserIds: ["222"] }, "file", 0, "123", "456");
	assert.deepEqual(unknown.audience_user_ids, []);
	const current = archivedEvent({ ...base, eventId: "event-1", audienceVersion: 1, audienceUserIds: ["111", "222", "111"] }, "file", 0, "123", "456");
	assert.deepEqual(current.audience_user_ids, ["111", "222"]);
	assert.equal(current.event_id, "event-1");
	for (const change of [
		{ audienceVersion: 1 }, { audienceVersion: 1, audienceUserIds: [null] },
		{ guildId: "999" }, { channelId: "999" }, { end: "2026-10-03T19:00:00Z" },
		{ at: "invalid" }, { text: "invalid\0text" }, { eventId: "../path" },
	]) assert.throws(() => archivedEvent({ ...base, ...change }, "file", 0, "123", "456"));
});

test("PostgreSQL transcript archive enforces participation across queries, recovery and reader roles", {
	skip: process.env.CAITLYN_TEST_POSTGRES !== "1", timeout: 120_000,
}, async (context) => {
	const suffix = randomUUID().replaceAll("-", "");
	const database = "caitlyn_transcripts_" + suffix;
	const role = "caitlyn_reader_" + suffix;
	const connection = {
		host: "127.0.0.1", port: Number(process.env.CAITLYN_TEST_PGPORT ?? "5432"),
		user: process.env.CAITLYN_TEST_PGUSER ?? userInfo().username, password: process.env.CAITLYN_TEST_PGPASSWORD ?? "",
		connectionTimeoutMillis: 5_000, statement_timeout: 10_000, query_timeout: 15_000,
	};
	const administrator = new pg.Client({ ...connection, database: "postgres" });
	const writer = new pg.Pool({ ...connection, database });
	const readerPool = new pg.Pool({ ...connection, database, user: role, password: "", max: 1 });
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-transcript-db-"));
	const warnings = [];
	const archive = new TranscriptionArchive(writer, directory, "123", { warn: (message) => warnings.push(message) });
	let created = false;
	let roleCreated = false;
	try {
		await administrator.connect();
		await administrator.query("CREATE DATABASE \"" + database + "\" TEMPLATE template0");
		created = true;
		await writer.query("CREATE SCHEMA discord");
		const migration = await readFile(new URL("../migrations/017_transcript_archive.sql", import.meta.url), "utf8");
		await writer.query(migration);
		await writer.query(migration);
		await administrator.query("CREATE ROLE \"" + role + "\" LOGIN NOSUPERUSER NOBYPASSRLS");
		roleCreated = true;
		await writer.query("GRANT USAGE ON SCHEMA discord TO \"" + role + "\"");
		await writer.query("GRANT SELECT ON discord.transcript_events TO \"" + role + "\"");
		const reader = createTranscriptionReader(readerPool);
		const alice = { guildId: "123", userId: "111" };
		const carol = { guildId: "123", userId: "333" };
		const outsider = { guildId: "123", userId: "999" };
		const store = new TranscriptionStore(directory, "Europe/Amsterdam");
		await store.initialize();
		const event = (eventId, seconds, audienceUserIds, fields = {}) => ({
			...base, eventId, audienceVersion: 1, audienceUserIds,
			at: new Date(Date.parse(base.at) + seconds * 1000).toISOString(),
			end: new Date(Date.parse(base.at) + seconds * 1000 + 500).toISOString(), ...fields,
		});
		const records = [
			{ ...base, text: "Legacy operator-only recording" },
			event("before", 1, ["111"], { text: "Private before arrival" }),
			event("shared", 2, ["111", "333"], { text: "Shared pineapple conversation" }),
			event("absent", 3, ["111"], { text: "Private while Carol was away" }),
			event("rejoined", 4, ["111", "333"], { text: "Rejoined pineapple conversation" }),
			event("restricted", 5, ["111"], { type: "message_posted", activityChannelId: "901", activityChannelName: "staff", text: "Restricted message", messageId: "801" }),
			event("uncertain", 6, [], { text: "Uncertain membership" }),
			event("unrelated", 7, ["222"], { channelId: "457", channelName: "Other room", userId: "222", speaker: "bob", text: "Other room secret" }),
		];
		for (const record of records) await store.append(record);
		await archive.sync();

		await context.test("legacy and uncertain records are retained but deny all member access", async () => {
			assert.equal((await writer.query("SELECT count(*)::int AS n FROM discord.transcript_events")).rows[0].n, 8);
			assert.equal((await reader.events(alice)).events.length, 5);
			assert.deepEqual((await reader.events(carol)).events.map((row) => row.event_id), ["rejoined", "shared"]);
			assert.deepEqual((await reader.events(outsider)).events, []);
			assert.deepEqual((await reader.events({ ...alice, guildId: "999" })).events, []);
			await assert.rejects(createTranscriptionReader(writer).events(alice), /unprivileged role/);
		});

		await context.test("search, session filters, menus and pagination cannot reveal inaccessible records", async () => {
			assert.deepEqual((await reader.events(carol, { query: "pineapple", limit: 1 })).events.map((row) => row.event_id), ["rejoined"]);
			const page = await reader.events(carol, { limit: 1 });
			const next = await reader.events(carol, { limit: 1, cursor: page.cursor });
			assert.deepEqual(next.events.map((row) => row.event_id), ["shared"]);
			assert.equal(next.cursor, null);
			assert.deepEqual((await reader.events(carol, { query: "Private OR Restricted", sessionId: "session-one" })).events, []);
			assert.deepEqual((await reader.events(carol, { channelId: "457" })).events, []);
			assert.deepEqual((await reader.events(carol, { activityChannelId: "901" })).events, []);
			const filters = await reader.filters(carol);
			assert.deepEqual(filters.users, [{ user_id: "111", username: "alice_account" }]);
			assert.deepEqual(filters.channels, [{ channel_id: "456", channel_name: "Voice room" }]);
			assert.deepEqual(filters.activityChannels, []);
			assert.deepEqual((await reader.events(carol, { from: "2026-10-03T20:00:03Z", until: "2026-10-03T20:00:05Z" })).events.map((row) => row.event_id), ["rejoined"]);
			await assert.rejects(reader.events(carol, { from: "2026-10-03" }), /timezone/);
		});

		await context.test("transaction-local identity does not leak through pooled connections or failed queries", async () => {
			const direct = await readerPool.query("SELECT * FROM discord.transcript_events WHERE event_id = 'before'");
			assert.equal(direct.rows.length, 0);
			await assert.rejects(readerPool.query("SELECT * FROM discord.transcript_import_offsets"), /permission denied/);
			await assert.rejects(readerPool.query("UPDATE discord.transcript_events SET content = 'tampered'"), /permission denied/);
			const pages = await Promise.all([reader.events(alice), reader.events(carol), reader.events(outsider)]);
			assert.deepEqual(pages.map((page) => page.events.length), [5, 2, 0]);
			await assert.rejects(reader.events(carol, { cursor: Buffer.from(JSON.stringify(["bad", "before"])).toString("base64url") }));
			assert.equal((await readerPool.query("SELECT count(*)::int AS n FROM discord.transcript_events")).rows[0].n, 0);
		});

		await context.test("replay and an interrupted final line preserve exactly one immutable copy per event", async () => {
			await writer.query("DELETE FROM discord.transcript_import_offsets");
			await archive.sync();
			assert.equal((await writer.query("SELECT count(*)::int AS n FROM discord.transcript_events")).rows[0].n, 8);
			const late = event("late", 8, ["111", "333"], { text: "Full multiline\nmessage \u2028 retained" });
			const file = join(directory, "123", "456", "2026-10-03.jsonl");
			const line = JSON.stringify(late);
			await appendFile(file, line.slice(0, 30));
			await archive.sync();
			assert.equal((await writer.query("SELECT count(*)::int AS n FROM discord.transcript_events")).rows[0].n, 8);
			await appendFile(file, line.slice(30) + "\n");
			await archive.sync();
			assert.equal((await reader.events(carol)).events[0].content, late.text);
			await store.append({ ...records[1], audienceUserIds: ["333"] });
			await archive.sync();
			assert.deepEqual((await reader.events(carol, { query: "before" })).events, []);
		});

		await context.test("database interruption leaves file checkpoints recoverable and retries without lost events", async () => {
			const disconnected = new TranscriptionArchive({ connect: async () => { throw new Error("offline"); } }, directory, "123", { warn: (message) => warnings.push(message) });
			await store.append(event("offline", 9, ["111", "333"], { text: "Recorded while database offline" }));
			await disconnected.sync();
			await disconnected.sync();
			assert.match(disconnected.status(), /^retrying/);
			assert.equal(warnings.length, 1);
			assert.ok(!warnings[0].includes("Recorded while"));
			await archive.sync();
			assert.ok((await reader.events(carol)).events.some((row) => row.event_id === "offline"));
			assert.match(archive.status(), /^synced/);
		});
	}
	finally {
		await archive.stop();
		await readerPool.end();
		await writer.end();
		if (created) await administrator.query("DROP DATABASE \"" + database + "\"");
		if (roleCreated) await administrator.query("DROP ROLE \"" + role + "\"");
		await administrator.end();
		await rm(directory, { recursive: true, force: true });
	}
});
