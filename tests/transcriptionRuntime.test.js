/**
 * @file transcriptionRuntime.test.js
 * @description Tests automatic voice selection, speaker lifecycle, durable pause and recovery using synthetic Discord.
 * @module transcriptionRuntime.test
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { ChannelType, Collection, Events, PermissionFlagsBits } from "discord.js";
import { TranscriptionRuntime, transcriptionRuntimes } from "../core/transcriptionRuntime.ts";
import { execute } from "../commands/utility/transcribe.ts";
import { startBot } from "../main.ts";

function fixture() {
	const records = [];
	const captures = [];
	const notices = [];
	let paused = false;
	let now = Date.parse("2026-10-01T12:00:00Z");
	const guild = { id: "123", channels: { cache: new Collection() } };
	const client = Object.assign(new EventEmitter(), { user: { id: "999" }, guilds: { cache: new Collection([[guild.id, guild]]) }, isReady: () => true });
	const channel = (id, position = 0, type = ChannelType.GuildVoice) => {
		const value = { id, name: `Room ${id}`, type, rawPosition: position, guild, members: new Collection(), permissionsFor: () => ({ has: () => true }), send: async (notice) => { notices.push(notice); } };
		guild.channels.cache.set(id, value);
		return value;
	};
	const member = (id, name = "Speaker", bot = false) => ({ id, displayName: name, user: { bot } });
	const first = channel("456");
	const second = channel("457", 1);
	first.members.set("111", member("111", "Alice"));
	second.members.set("222", member("222", "Bob"));
	const config = { guildId: guild.id, directory: "/unused", endpoint: "http://worker:8095/transcribe", channels: ["*"], timezone: "Europe/Amsterdam", language: "en" };
	const dependencies = {
		store: { initialize: async () => undefined, paused: async () => paused, setPaused: async (value) => { paused = value; }, append: async (entry) => { records.push(entry); }, drain: async () => undefined },
		connect: (room, packet, failure) => {
			const capture = { room, packet, failure, ready: Promise.resolve(), ids: [], closed: false,
				sync(ids) { this.ids = ids; },
				close() { this.closed = true; },
			};
			captures.push(capture);
			return capture;
		},
		transcribe: async (pcm) => `speech-${pcm[0]}`,
		now: () => now,
		log: { info: () => undefined, warn: () => undefined },
	};
	const runtime = new TranscriptionRuntime(client, config, dependencies);
	return { runtime, records, captures, notices, first, second, client, guild, config, dependencies, channel, member, advance: (ms) => { now += ms; }, now: () => now };
}

test("automatic recording sticks with a conversation, captures joiners separately and follows occupied channels", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	await f.runtime.start();
	await setImmediate();
	assert.equal(f.captures[0].room.id, "456");
	assert.deepEqual(f.captures[0].ids, ["111"]);
	assert.match(f.notices[0].content, /transcribing.*Mainframe/);
	f.first.members.set("333", f.member("333", "Carol"));
	f.first.members.set("444", f.member("444", "Robot", true));
	await f.runtime.reconcile();
	assert.deepEqual(f.captures[0].ids, ["111", "333"]);
	f.captures[0].packet("111", Buffer.alloc(640, 1), f.now());
	f.captures[0].packet("333", Buffer.alloc(640, 2), f.now());
	f.first.members.delete("111");
	await f.runtime.reconcile();
	assert.equal(f.captures.length, 1);
	f.first.members.delete("333");
	f.advance(16_000);
	await f.runtime.reconcile();
	assert.equal(f.captures[0].closed, true);
	assert.equal(f.captures[1].room.id, "457");
	await f.runtime.stop();
	assert.deepEqual(f.records.filter((entry) => entry.type === "transcript").map((entry) => [entry.userId, entry.speaker, entry.text]), [["111", "Alice", "speech-1"], ["333", "Carol", "speech-2"]]);
	assert.equal(f.client.listenerCount(Events.VoiceStateUpdate), 0);
});

test("pause persists across restarts, stops receiving immediately and resume explicitly enables automation", async () => {
	const f = fixture();
	await f.runtime.start();
	await f.runtime.pause();
	assert.equal(f.captures[0].closed, true);
	await f.runtime.stop();
	const restarted = new TranscriptionRuntime(f.client, f.config, f.dependencies);
	try {
		await restarted.start();
		assert.match(restarted.status(), /paused/);
		assert.equal(f.captures.length, 1);
		await restarted.resume("457");
		assert.equal(f.captures.at(-1).room.id, "457");
	}
	finally { await restarted.stop(); }
});

test("disconnects record gaps and reconnect with backoff, ignoring bot-only, stage and unconfigured channels", async (context) => {
	const f = fixture();
	f.config.channels = ["456"];
	context.after(() => f.runtime.stop());
	await f.runtime.start();
	f.captures[0].failure();
	await f.runtime.reconcile();
	assert.equal(f.captures[0].closed, true);
	assert.equal(f.captures.length, 1);
	assert.ok(f.records.some((entry) => entry.type === "gap"));
	f.advance(16_000);
	await f.runtime.reconcile();
	assert.equal(f.captures.length, 2);
	f.first.members.clear();
	f.channel("900", -1, ChannelType.GuildStageVoice).members.set("333", f.member("333"));
	f.advance(16_000);
	await f.runtime.reconcile();
	assert.match(f.runtime.status(), /waiting/);
	assert.equal(f.captures.length, 2);
});

test("failed notice or storage closes recording instead of silently continuing", async () => {
	for (const fail of ["notice", "storage"]) {
		const f = fixture();
		if (fail === "notice") f.first.send = async () => { throw new Error("permission"); };
		else f.dependencies.store.append = async () => { throw new Error("disk full"); };
		try {
			await f.runtime.start();
			await setImmediate();
			await f.runtime.reconcile();
			assert.equal(f.captures[0].closed, true);
		}
		finally { await f.runtime.stop(); }
	}
});

test("transcription command checks administrator and guild access before mutations and never exposes logs", async () => {
	const f = fixture();
	transcriptionRuntimes.set(f.client, f.runtime);
	const replies = [];
	let admin = false;
	const interaction = {
		guild: f.guild, guildId: "123", client: f.client, memberPermissions: { has: (permission) => { assert.equal(permission, PermissionFlagsBits.Administrator); return admin; } },
		options: { getSubcommand: () => "stop" }, user: { id: "111" },
		reply: async (payload) => { replies.push(payload); }, deferReply: async () => undefined, editReply: async (payload) => { replies.push(payload); },
	};
	await execute(interaction);
	assert.match(replies[0].content, /Only server administrators/);
	admin = true;
	interaction.guildId = "other";
	await execute(interaction);
	assert.match(replies[1], /disabled/);
	interaction.guildId = "123";
	await execute(interaction);
	assert.match(replies[2].embeds[0].data.description, /paused/);
	assert.ok(!JSON.stringify(replies).includes("speech-"));
});

test("bot lifecycle starts transcription after login, drains it before Discord closes and isolates startup failure", async () => {
	for (const startupFails of [false, true]) {
		const calls = [];
		const client = { destroy: async () => { calls.push("destroy"); } };
		const runtime = {
			start: async () => {
				calls.push("start transcription");
				if (startupFails) throw new Error("private storage failure");
			},
			stop: async () => { calls.push("stop transcription"); },
		};
		const bot = await startBot({
			validateEnvironment: () => undefined, createClient: () => client, createTranscriptionRuntime: () => runtime,
			createPGPool: async () => undefined, closeDatabase: async () => { calls.push("close database"); },
			commandHandler: async () => undefined, eventHandler: async () => undefined, drainEvents: async () => undefined,
			loginClient: async () => { calls.push("login"); }, startCronJobs: () => async () => undefined,
			logger: { info: () => undefined, error: (message) => { assert.ok(!message.includes("private storage failure")); } },
		});
		assert.equal(transcriptionRuntimes.has(client), !startupFails);
		await bot.stop();
		await bot.stop();
		assert.equal(transcriptionRuntimes.has(client), false);
		assert.deepEqual(calls, ["login", "start transcription", "stop transcription", "destroy", "close database"]);
	}
});
