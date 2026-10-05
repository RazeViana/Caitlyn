/**
 * @file transcriptionProfiles.test.js
 * @description Verifies profile updates, removed avatars, reconciliation retries and lifecycle cleanup.
 * @module transcriptionProfiles.test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Events } from "discord.js";
import { TranscriptionProfiles } from "../core/transcriptionProfiles.ts";

test("profile changes update names and avatars; reconciliation repairs missed events without fetching on every update", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 1_000_000 });
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-profiles-"));
	const member = { id: "111", displayName: "Before", user: { avatar: "a".repeat(32) }, avatar: "b".repeat(32) };
	let requests = 0;
	let unavailable = false;
	const members = { cache: new Map([[member.id, member]]), fetch: async () => {
		requests++;
		if (unavailable) throw new Error("Offline");
	} };
	const client = Object.assign(new EventEmitter(), { guilds: { cache: new Map([["123", { members }]]) } });
	let warnings = 0;
	const worker = new TranscriptionProfiles(client, directory, "123", () => { warnings++; });
	const read = async () => JSON.parse(await readFile(join(directory, "profiles.json"), "utf8"));
	try {
		await worker.start();
		assert.equal(requests, 1);
		assert.equal((await read()).users["111"].displayName, "Before");
		member.displayName = "After";
		member.user.avatar = null;
		member.avatar = null;
		client.emit(Events.UserUpdate);
		client.emit(Events.GuildMemberUpdate);
		t.mock.timers.tick(250);
		await worker.refresh();
		assert.deepEqual((await read()).users["111"], { avatarHash: null, guildAvatarHash: null, displayName: "After" });
		assert.equal(requests, 1);
		unavailable = true;
		t.mock.timers.tick(300_000);
		await worker.refresh();
		assert.ok(warnings > 0);
		unavailable = false;
		member.displayName = "Reconciled";
		await worker.refresh();
		assert.equal((await read()).users["111"].displayName, "Reconciled");
		const beforeReconnect = requests;
		client.emit(Events.ShardResume);
		t.mock.timers.tick(250);
		await worker.refresh();
		assert.equal(requests, beforeReconnect + 1);
		members.cache.delete("111");
		client.emit(Events.GuildMemberRemove);
		t.mock.timers.tick(250);
		await worker.refresh();
		assert.deepEqual((await read()).users, {});
		await worker.stop();
		assert.equal(client.eventNames().length, 0);
		const beforeStop = requests;
		t.mock.timers.tick(600_000);
		await worker.refresh();
		assert.equal(requests, beforeStop);
	}
	finally {
		await worker.stop();
		await rm(directory, { recursive: true, force: true });
	}
});
