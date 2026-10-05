/**
 * @file transcriptionAssets.test.js
 * @description Checks durable uploads, rejected sources, old revision matching, restart replay and profile snapshots.
 * @module transcriptionAssets.test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { attachmentUrl, captureAttachments, downloadAttachment, sameMessageRevision, assetEventKey, assetFileKey, TranscriptionAssets } from "../core/transcriptionAssets.ts";

const upload = { id: "789", name: "clip.mp4", size: 6, contentType: "video/mp4", url: "https://cdn.discordapp.com/attachments/456/789/clip.mp4?ex=123&hm=private" };
const row = { event_id: "message-321", guild_id: "123", activity_channel_id: "456", message_id: "321", event_type: "message_posted", occurred_at: new Date("2026-10-05T12:00:00Z"), content: "File", metadata: { attachmentNames: [upload.name], attachments: [upload] } };
const stored = { ...upload, key: assetFileKey("123", row.event_id, upload.id), state: "pending", attempts: 0, retryAt: 0 };

test("uploads accept only exact Discord attachment paths and preserve immutable IDs", () => {
	assert.ok(attachmentUrl(upload.url, "456", "789"));
	for (const url of ["http://cdn.discordapp.com/attachments/456/789/a", "https://evil.test/attachments/456/789/a", "https://cdn.discordapp.com:444/attachments/456/789/a", "https://cdn.discordapp.com/attachments/456/789/../../a", "https://cdn.discordapp.com/attachments/999/789/a"]) assert.equal(attachmentUrl(url, "456", "789"), false);
	assert.deepEqual(captureAttachments([upload, { name: "missing-metadata" }], "456"), [upload]);
	const message = { createdTimestamp: row.occurred_at.getTime(), editedTimestamp: null, content: "File", attachments: [upload] };
	assert.ok(sameMessageRevision(row, message));
	assert.equal(sameMessageRevision(row, { ...message, editedTimestamp: Date.now() }), false);
	assert.equal(sameMessageRevision(row, { ...message, content: "Changed" }), false);
	assert.equal(sameMessageRevision(row, { ...message, attachments: [{ ...upload, name: "new.mp4" }] }), false);
});

test("streamed files are atomic, private, checked for truncation and bounded by captured size", async () => {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-upload-"));
	try {
		let options;
		const hash = await downloadAttachment(directory, stored, "456", async (_url, init) => {
			options = init;
			return new Response("abcdef");
		});
		assert.match(hash, /^[a-f0-9]{64}$/);
		assert.equal(options.redirect, "error");
		assert.equal(await readFile(join(directory, stored.key + ".bin"), "utf8"), "abcdef");
		assert.equal((await stat(join(directory, stored.key + ".bin"))).mode & 0o777, 0o600);
		for (const bytes of ["short", "too-long"]) await assert.rejects(downloadAttachment(directory, stored, "456", async () => new Response(bytes)));
		assert.equal(await readFile(join(directory, stored.key + ".bin"), "utf8"), "abcdef");
		assert.deepEqual(await readdir(directory), [stored.key + ".bin"]);
		await assert.rejects(downloadAttachment(directory, { ...stored, size: 2 ** 31 }, "456"));
		await assert.rejects(downloadAttachment(directory, { ...stored, url: "https://127.0.0.1/private" }, "456"));
	}
	finally { await rm(directory, { recursive: true, force: true }); }
});

test("ready files survive worker replay; profile export includes server and global avatars", async () => {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-assets-"));
	const member = { id: "111", displayName: "Member", user: { avatar: "a".repeat(32) }, avatar: "b".repeat(32) };
	const client = Object.assign(new EventEmitter(), { guilds: { cache: new Map([["123", { members: { cache: new Map([["111", member]]), fetch: async () => new Map([["111", member]]) } }]]) } });
	const db = { query: async () => ({ rows: [] }) };
	const warnings = [];
	const worker = new TranscriptionAssets(client, db, directory, "123", { warn: (value) => warnings.push(value) });
	const previous = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests++;
		return new Response("abcdef");
	};
	try {
		await worker.start();
		await worker.save(row);
		await worker.save(row);
		assert.equal(requests, 1);
		const manifest = JSON.parse(await readFile(join(directory, "assets", "123", "events", assetEventKey("123", row.event_id) + ".json"), "utf8"));
		assert.equal(manifest.attachments[0].state, "ready");
		assert.equal(manifest.attachments[0].url, "");
		const profiles = JSON.parse(await readFile(join(directory, "assets", "123", "profiles.json"), "utf8"));
		assert.equal(profiles.users["111"].guildAvatarHash, member.avatar);
		assert.equal(warnings.length, 0);
		await mkdir(join(directory, "unrelated"));
	}
	finally {
		globalThis.fetch = previous;
		await worker.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
