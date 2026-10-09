/**
 * @file transcriptionRuntime.test.js
 * @description Tests voice selection, username-attributed participant activity, real join/leave events, durable pause and recovery using synthetic Discord.
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
import logger, { subscribeLogs } from "../core/logger.ts";

function fixture() {
	const records = [];
	const captures = [];
	const notices = [];
	let paused = false;
	let savedSettings = {};
	let now = Date.parse("2026-10-01T12:00:00Z");
	const guild = { id: "123", channels: { cache: new Collection() } };
	const client = Object.assign(new EventEmitter(), { user: { id: "999" }, guilds: { cache: new Collection([[guild.id, guild]]) }, isReady: () => true });
	const channel = (id, position = 0, type = ChannelType.GuildVoice) => {
		const value = { id, name: `Room ${id}`, type, rawPosition: position, guild, members: new Collection(), permissionsFor: () => ({ has: () => true }), send: async (notice) => { notices.push(notice); } };
		guild.channels.cache.set(id, value);
		return value;
	};
	const member = (id, username = "Speaker", bot = false) => ({ id, displayName: `Server nickname ${username}`, user: { id, bot, username, globalName: `Display name ${username}` } });
	const voiceState = (person, room, fields = {}) => ({ guild, id: person.id, member: person, channel: room ?? null, channelId: room?.id ?? null,
		selfMute: false, selfDeaf: false, serverMute: false, serverDeaf: false, streaming: false, selfVideo: false, ...fields });
	const post = (id, person, fields = {}) => {
		const message = { id, author: person.user, guildId: guild.id, createdTimestamp: now, content: "A message", attachments: new Collection(), system: false, webhookId: null,
			channel: { id: "900", name: "general", isThread: () => false, permissionsFor: () => ({ has: () => true }) }, inGuild() { return this.guildId !== null; }, ...fields };
		return { ...message, channelId: message.channel.id, url: `https://discord.com/channels/${message.guildId}/${message.channel.id}/${message.id}` };
	};
	const first = channel("456");
	const second = channel("457", 1);
	first.members.set("111", member("111", "Alice"));
	first.members.set("555", member("555", "Eve"));
	second.members.set("222", member("222", "Bob"));
	second.members.set("666", member("666", "Dan"));
	const config = { guildId: guild.id, directory: "/unused", endpoint: "http://worker:8095/transcribe", channels: ["*"], timezone: "Europe/Amsterdam", language: "en" };
	const dependencies = {
		store: { initialize: async () => undefined, paused: async () => paused, settings: async () => savedSettings,
			updateSettings: async (value) => { savedSettings = { ...savedSettings, ...value }; }, setPaused: async (value) => { paused = value; },
			append: async (entry) => { records.push(entry); }, drain: async () => undefined },
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
	return { runtime, records, captures, notices, first, second, client, guild, config, dependencies, channel, member, voiceState, post, advance: (ms) => { now += ms; }, now: () => now };
}

test("solo channels and bots stay unrecorded and healthy, including manual start, while text is archived", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	f.first.members.delete("555");
	f.second.members.delete("666");
	f.first.members.set("999", f.member("999", "Caitlyn", true));
	await f.runtime.start();
	await f.runtime.resume("456");
	assert.equal(f.captures.length, 0);
	assert.equal(f.notices.length, 0);
	assert.equal(f.runtime.healthSnapshot().captureHealthy, true);
	assert.equal(f.runtime.healthSnapshot().recording, false);
	assert.equal(f.runtime.voicePresence(), null);
	assert.match(f.runtime.status(), /waiting for at least two people/);
	const robot = f.member("444", "Robot", true);
	f.first.members.set(robot.id, robot);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(robot, null), f.voiceState(robot, f.first));
	f.client.emit(Events.MessageCreate, f.post("801", f.first.members.get("111")));
	await f.runtime.reconcile();
	await setImmediate();
	assert.equal(f.captures.length, 0);
	assert.ok(f.records.some((record) => record.type === "message_posted" && record.messageId === "801"));
	const carol = f.member("333", "Carol");
	f.first.members.set(carol.id, carol);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, null), f.voiceState(carol, f.first));
	await f.runtime.reconcile();
	await setImmediate();
	assert.equal(f.captures.length, 1);
	assert.deepEqual(f.captures[0].ids, ["111", "333"]);
	assert.equal(f.runtime.healthSnapshot().recording, true);
});

test("dropping below two stops reception immediately, preserves earlier group speech and resumes without backoff", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	f.second.members.clear();
	await f.runtime.start();
	await setImmediate();
	const capture = f.captures[0];
	const eve = f.first.members.get("555");
	capture.packet("111", Buffer.alloc(640, 1), f.now());
	f.advance(100);
	f.first.members.delete(eve.id);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(eve, f.first), f.voiceState(eve, null));
	assert.equal(capture.closed, true);
	assert.equal(f.runtime.voicePresence(), null);
	assert.equal(f.runtime.healthSnapshot().recording, false);
	assert.equal(f.runtime.healthSnapshot().captureHealthy, true);
	capture.packet("111", Buffer.alloc(640, 2), f.now());
	await f.runtime.reconcile();
	assert.match(f.runtime.status(), /waiting for at least two people/);
	assert.equal(f.captures.length, 1);
	f.advance(100);
	f.first.members.set(eve.id, eve);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(eve, null), f.voiceState(eve, f.first));
	await f.runtime.reconcile();
	await setImmediate();
	assert.equal(f.captures.length, 2);
	capture.packet("111", Buffer.alloc(640, 3), f.now());
	f.captures[1].packet("111", Buffer.alloc(640, 4), f.now());
	await f.runtime.stop();
	const speech = f.records.filter((record) => record.type === "transcript");
	assert.deepEqual(speech.map((record) => [record.text, record.audienceUserIds]), [["speech-1", ["111", "555"]], ["speech-4", ["111", "555"]]]);
	assert.notEqual(speech[0].sessionId, speech[1].sessionId);
	assert.equal(f.records.filter((record) => record.type === "gap").length, 0);
	assert.deepEqual(f.records.filter((record) => record.type === "left").map((record) => record.userId), ["555"]);
	assert.ok(f.records.some((record) => record.type === "session_stopped" && /Fewer than two/.test(record.text)));
});

test("a rapid leave and rejoin cannot revive a capture that ended with a solo participant", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	f.second.members.clear();
	await f.runtime.start();
	const capture = f.captures[0];
	const eve = f.first.members.get("555");
	f.first.members.delete(eve.id);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(eve, f.first), f.voiceState(eve, null));
	f.first.members.set(eve.id, eve);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(eve, null), f.voiceState(eve, f.first));
	capture.packet("111", Buffer.alloc(640, 2), f.now());
	await f.runtime.reconcile();
	await setImmediate();
	assert.equal(capture.closed, true);
	assert.equal(f.captures.length, 2);
	await f.runtime.stop();
	assert.equal(f.records.filter((record) => record.type === "transcript" || record.type === "gap").length, 0);
});

test("a delayed voice handshake cannot announce or record after the second person leaves", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	f.second.members.clear();
	let ready;
	const handshake = new Promise((resolve) => { ready = resolve; });
	f.runtime = new TranscriptionRuntime(f.client, f.config, { ...f.dependencies, connect: (...args) => {
		const capture = f.dependencies.connect(...args);
		capture.ready = handshake;
		return capture;
	} });
	await f.runtime.start();
	const eve = f.first.members.get("555");
	f.first.members.delete(eve.id);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(eve, f.first), f.voiceState(eve, null));
	ready();
	f.captures[0].packet("111", Buffer.alloc(640, 1), f.now());
	await f.runtime.reconcile();
	await setImmediate();
	assert.equal(f.captures[0].closed, true);
	assert.equal(f.notices.length, 0);
	await f.runtime.stop();
	assert.equal(f.records.filter((record) => ["transcript", "gap", "session_started"].includes(record.type)).length, 0);
});

test("a cache-only departure fences packets and keeps the uncertain buffered audience private", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	f.second.members.clear();
	await f.runtime.start();
	await setImmediate();
	f.captures[0].packet("111", Buffer.alloc(640, 1), f.now());
	f.first.members.delete("555");
	assert.equal(f.runtime.voicePresence(), null);
	f.captures[0].packet("111", Buffer.alloc(640, 2), f.now());
	assert.equal(f.captures[0].closed, true);
	await f.runtime.reconcile();
	await f.runtime.stop();
	assert.deepEqual(f.records.filter((record) => record.type === "transcript").map((record) => [record.text, record.audienceUserIds]), [["speech-1", []]]);
});

test("live presence follows current human membership and disappears when capture is not trustworthy", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	assert.equal(f.runtime.voicePresence(), null);
	await f.runtime.start();
	await setImmediate();
	assert.deepEqual(f.runtime.voicePresence(), { channelId: "456", channelName: "Room 456", members: [{ userId: "111", displayName: "Server nickname Alice" }, { userId: "555", displayName: "Server nickname Eve" }] });
	const carol = f.member("333", "Carol");
	f.first.members.set(carol.id, carol);
	f.first.members.set("444", f.member("444", "Robot", true));
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, null), f.voiceState(carol, f.first));
	assert.deepEqual(f.runtime.voicePresence().members.map((member) => member.userId), ["111", "555", "333"]);
	f.first.members.delete(carol.id);
	// Presence must not wait for reconciliation or infer attendance from buffered speech.
	assert.deepEqual(f.runtime.voicePresence().members.map((member) => member.userId), ["111", "555"]);
	f.first.members.get("111").displayName = "New nickname";
	assert.equal(f.runtime.voicePresence().members[0].displayName, "New nickname");
	f.client.isReady = () => false;
	assert.equal(f.runtime.voicePresence(), null);
	f.client.isReady = () => true;
	f.guild.available = false;
	assert.equal(f.runtime.voicePresence(), null);
	f.guild.available = true;
	f.captures[0].failure();
	assert.equal(f.runtime.voicePresence(), null);
	await setImmediate();
	f.advance(16_000);
	await f.runtime.reconcile();
	await setImmediate();
	assert.equal(f.runtime.voicePresence().members.length, 2);
	await f.runtime.pause();
	assert.equal(f.runtime.voicePresence(), null);
	await f.runtime.stop();
	assert.equal(f.runtime.voicePresence(), null);
});

test("automatic recording sticks with a conversation, captures joiners separately and follows occupied channels", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	await f.runtime.start();
	await setImmediate();
	assert.equal(f.captures[0].room.id, "456");
	assert.deepEqual(f.captures[0].ids, ["111", "555"]);
	assert.match(f.notices[0].content, /transcribing.*Mainframe/);
	f.first.members.set("333", f.member("333", "Carol"));
	f.first.members.set("444", f.member("444", "Robot", true));
	await f.runtime.reconcile();
	assert.deepEqual(f.captures[0].ids, ["111", "555", "333"]);
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
	const usernames = { "111": "Alice", "222": "Bob", "333": "Carol", "555": "Eve", "666": "Dan" };
	for (const entry of f.records.filter((record) => record.userId)) assert.equal(entry.speaker, usernames[entry.userId]);
	assert.equal(f.client.listenerCount(Events.VoiceStateUpdate), 0);
	assert.equal(f.client.listenerCount(Events.MessageCreate), 0);
});

test("voice arrivals and departures are captured even within one reconciliation tick, without inventing departures on pause", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	await f.runtime.start();
	await setImmediate();
	assert.deepEqual(f.records.filter((entry) => entry.type === "present").map((entry) => entry.userId), ["111", "555"]);
	assert.equal(f.records.filter((entry) => entry.type === "joined").length, 0);
	const carol = f.member("333", "carol_account");
	f.advance(10);
	f.first.members.set(carol.id, carol);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, f.second), f.voiceState(carol, f.first));
	const arrival = f.now();
	assert.deepEqual(f.captures[0].ids, ["111", "555", "333"]);
	f.captures[0].packet(carol.id, Buffer.alloc(640, 3), f.now());
	f.advance(10);
	f.first.members.delete(carol.id);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, f.first), f.voiceState(carol, f.second));
	const departure = f.now();
	assert.deepEqual(f.captures[0].ids, ["111", "555"]);
	await f.runtime.pause();
	await f.runtime.stop();
	const joined = f.records.filter((entry) => entry.type === "joined");
	const left = f.records.filter((entry) => entry.type === "left");
	assert.deepEqual(joined.map((entry) => [entry.userId, entry.speaker, entry.at]), [["333", "carol_account", new Date(arrival).toISOString()]]);
	assert.deepEqual(left.map((entry) => [entry.userId, entry.speaker, entry.at]), [["333", "carol_account", new Date(departure).toISOString()]]);
	assert.match(joined[0].text, /Moved from.*457/);
	assert.match(left[0].text, /Moved to.*457/);
	assert.ok(f.records.some((entry) => entry.type === "transcript" && entry.userId === "333"));
	assert.ok(f.records.some((entry) => entry.type === "session_stopped" && /administrator/.test(entry.text)));
});

test("the arrival that opens a recording keeps its event timestamp while existing occupants are snapshots", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	const alice = f.first.members.get("111");
	f.first.members.delete(alice.id);
	f.second.members.clear();
	await f.runtime.start();
	f.advance(20);
	const arrivedAt = f.now();
	f.first.members.set(alice.id, alice);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(alice, null), f.voiceState(alice, f.first));
	f.advance(100);
	await f.runtime.reconcile();
	await setImmediate();
	assert.equal(f.records.find((entry) => entry.type === "joined").at, new Date(arrivedAt).toISOString());
	assert.equal(f.records.filter((entry) => entry.type === "present").length, 1);
	f.captures[0].failure();
	await f.runtime.reconcile();
	f.advance(16_000);
	await f.runtime.reconcile();
	assert.equal(f.records.filter((entry) => entry.type === "joined").length, 1);
	assert.equal(f.records.filter((entry) => entry.type === "left").length, 0);
	assert.ok(f.records.some((entry) => entry.type === "present"));
});

test("guild chat posts include members outside voice, bots, webhooks and paused voice while excluding other guilds and duplicates", async () => {
	const f = fixture();
	try {
		await f.runtime.start();
		await setImmediate();
		const alice = f.first.members.get("111");
		const bob = f.second.members.get("222");
		const content = "Message text\nwith a second line and @everyone";
		const message = f.post("901", alice, { content, attachments: new Collection([["a", { name: "photo.png" }]]) });
		f.client.emit(Events.MessageCreate, message);
		f.client.emit(Events.MessageCreate, message);
		f.client.emit(Events.MessageCreate, f.post("902", bob));
		f.client.emit(Events.MessageCreate, f.post("903", alice, { guildId: "other" }));
		f.client.emit(Events.MessageCreate, f.post("904", alice, { guildId: null }));
		f.client.emit(Events.MessageCreate, f.post("905", alice, { system: true }));
		f.client.emit(Events.MessageCreate, f.post("906", alice, { webhookId: "999" }));
		f.client.emit(Events.MessageCreate, f.post("907", f.member("111", "robot", true)));
		f.client.emit(Events.MessageCreate, f.post("914", alice, { createdTimestamp: f.now() - 1 }));
		f.advance(100);
		const carol = f.member("333", "carol_account");
		f.first.members.set(carol.id, carol);
		f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, null), f.voiceState(carol, f.first));
		f.client.emit(Events.MessageCreate, f.post("915", carol, { createdTimestamp: f.now() - 10 }));
		const thread = f.post("908", alice, { channel: { id: "910", name: "discussion", isThread: () => true, parent: { id: "909", name: "forum" } } });
		f.client.emit(Events.MessageCreate, thread);
		f.first.members.delete(alice.id);
		f.client.emit(Events.MessageCreate, f.post("911", alice));
		f.first.members.set(alice.id, alice);
		await f.runtime.pause();
		f.client.emit(Events.MessageCreate, f.post("912", alice));
		await f.runtime.stop();
		f.client.emit(Events.MessageCreate, f.post("913", alice));
		const posts = f.records.filter((entry) => entry.type === "message_posted");
		assert.deepEqual(posts.map((post) => post.messageId), ["901", "902", "906", "907", "914", "915", "908", "911", "912"]);
		assert.deepEqual([posts[0].speaker, posts[0].userId, posts[0].channelId, posts[0].activityChannelId, posts[0].activityChannelName], ["Alice", "111", "900", "900", "general"]);
		assert.equal(posts[0].text, content);
		assert.equal(posts[0].at, new Date(message.createdTimestamp).toISOString());
		assert.equal(posts[0].messageUrl, message.url);
		assert.deepEqual(posts[0].attachmentNames, ["photo.png"]);
		assert.deepEqual([posts[6].activityChannelId, posts[6].activityParentChannelId, posts[6].activityParentChannelName], ["910", "909", "forum"]);
		assert.equal(f.records.filter((entry) => entry.type === "transcript").length, 0);
		assert.equal(f.client.listenerCount(Events.MessageCreate), 0);
	}
	finally { await f.runtime.stop(); }
});

test("chat continues without an occupied voice channel and capturing the bot's own operational messages cannot form a log loop", async () => {
	const f = fixture();
	f.first.members.clear();
	f.second.members.clear();
	let forwarded = 0;
	f.dependencies.log.debug = () => {
		forwarded++;
		assert.ok(forwarded < 3, "own chat logs must not create another log");
		f.client.emit(Events.MessageCreate, f.post("802", f.member("999", "caitlyn", true), { content: "Operational log" }));
	};
	try {
		await f.runtime.start();
		await f.runtime.pause();
		f.client.emit(Events.MessageCreate, f.post("801", f.member("111", "account_name")));
		await setImmediate();
		await f.runtime.stop();
		assert.equal(f.captures.length, 0);
		assert.equal(forwarded, 1);
		assert.deepEqual(f.records.filter((record) => record.type === "message_posted").map((record) => record.messageId), ["801", "802"]);
	}
	finally { await f.runtime.stop(); }
});

test("voice activity records mute, deafen, camera and screen changes for current participants only", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	await f.runtime.start();
	const alice = f.first.members.get("111");
	const before = f.voiceState(alice, f.first);
	const after = f.voiceState(alice, f.first, { selfMute: true, selfDeaf: true, serverMute: true, serverDeaf: true, streaming: true, selfVideo: true });
	f.client.emit(Events.VoiceStateUpdate, before, after);
	f.client.emit(Events.VoiceStateUpdate, after, after);
	f.client.emit(Events.VoiceStateUpdate, before, { ...after, guild: { id: "other" } });
	const bob = f.second.members.get("222");
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(bob, f.second), f.voiceState(bob, f.second, { streaming: true }));
	f.client.emit(Events.VoiceStateUpdate, after, before);
	await f.runtime.pause();
	f.client.emit(Events.VoiceStateUpdate, before, after);
	const activity = f.records.filter((entry) => entry.type === "voice_activity");
	assert.equal(activity.length, 2);
	assert.equal(activity[0].speaker, "Alice");
	assert.match(activity[0].text, /Microphone muted.*Audio deafened.*Server muted.*Server deafened.*Screen sharing started.*Camera turned on/);
	assert.match(activity[1].text, /Microphone unmuted.*Audio undeafened.*Server unmuted.*Server undeafened.*Screen sharing stopped.*Camera turned off/);
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

test("transcript audiences follow join, leave and rejoin boundaries even when inference finishes afterwards", async () => {
	const f = fixture();
	let release;
	const delayed = new Promise((resolve) => { release = resolve; });
	f.runtime = new TranscriptionRuntime(f.client, f.config, {
		...f.dependencies, transcribe: async (pcm) => { await delayed; return "speech-" + pcm[0]; },
	});
	const carol = f.member("333", "carol");
	try {
		await f.runtime.start();
		await setImmediate();
		const capture = f.captures[0];
		capture.packet("111", Buffer.alloc(640, 1), f.now());
		f.advance(100);
		f.first.members.set(carol.id, carol);
		f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, null), f.voiceState(carol, f.first));
		capture.packet("111", Buffer.alloc(640, 2), f.now());
		f.advance(100);
		f.first.members.delete(carol.id);
		f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, f.first), f.voiceState(carol, null));
		capture.packet("111", Buffer.alloc(640, 3), f.now());
		f.advance(100);
		f.first.members.set(carol.id, carol);
		f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, null), f.voiceState(carol, f.first));
		capture.packet("111", Buffer.alloc(640, 4), f.now());
		await f.runtime.pause();
		assert.equal(f.records.filter((entry) => entry.type === "transcript").length, 0);
		release();
		await f.runtime.stop();
		const speech = f.records.filter((entry) => entry.type === "transcript");
		assert.deepEqual(speech.map((entry) => [entry.text, entry.audienceUserIds]), [
			["speech-1", ["111", "555"]], ["speech-2", ["111", "555", "333"]], ["speech-3", ["111", "555"]], ["speech-4", ["111", "555", "333"]],
		]);
		for (const record of f.records) {
			assert.equal(record.audienceVersion, 1);
			assert.ok(record.eventId);
			assert.ok(!record.audienceUserIds.includes("222"));
		}
		assert.equal(new Set(f.records.map((entry) => entry.eventId)).size, f.records.length);
	}
	finally { release(); await f.runtime.stop(); }
});

test("chat records carry source-channel identity independently of voice attendance; permissions are enforced by the database", async (context) => {
	const f = fixture();
	context.after(() => f.runtime.stop());
	await f.runtime.start();
	await setImmediate();
	const beforeArrival = f.now();
	f.advance(100);
	const carol = f.member("333", "carol");
	f.first.members.set(carol.id, carol);
	f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, null), f.voiceState(carol, f.first));
	const alice = f.first.members.get("111");
	f.client.emit(Events.MessageCreate, f.post("701", alice));
	f.client.emit(Events.MessageCreate, f.post("702", alice, { createdTimestamp: beforeArrival }));
	const privateChannel = {
		id: "901", name: "restricted", isThread: () => false,
		permissionsFor: (person) => ({ has: () => person.id === "111" }),
	};
	f.client.emit(Events.MessageCreate, f.post("703", alice, { channel: privateChannel }));
	const thread = {
		id: "902", name: "private-thread", type: ChannelType.PrivateThread, isThread: () => true,
		parent: { id: "901", name: "parent" }, members: { cache: new Collection([["111", {}]]) },
		permissionsFor: () => ({ has: (bits) => Array.isArray(bits) }),
	};
	f.client.emit(Events.MessageCreate, f.post("704", alice, { channel: thread }));
	f.client.emit(Events.MessageCreate, f.post("705", alice, { channel: { ...privateChannel, permissionsFor: () => null } }));
	await f.runtime.stop();
	assert.deepEqual(f.records.filter((entry) => entry.type === "message_posted").map((entry) => [entry.messageId, entry.audienceUserIds]), [
		["701", []], ["702", []], ["703", []], ["704", []], ["705", []],
	]);
});

test("uncertain membership and gateway loss keep buffered speech private", async () => {
	for (const mode of ["cache", "gateway"]) {
		const f = fixture();
		try {
			await f.runtime.start();
			await setImmediate();
			f.captures[0].packet("111", Buffer.alloc(640, 1), f.now());
			f.advance(50);
			if (mode === "cache") {
				f.first.members.delete("111");
				await f.runtime.reconcile();
			}
			else {
				f.client.emit(Events.ShardDisconnect);
				await f.runtime.reconcile();
				assert.equal(f.captures[0].closed, true);
			}
			await f.runtime.stop();
			assert.deepEqual(f.records.find((entry) => entry.type === "transcript").audienceUserIds, []);
			for (const record of f.records.filter((entry) => entry.type === "left" || entry.type === "gap")) assert.deepEqual(record.audienceUserIds, []);
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

test("recorded message edits and bulk deletions preserve originals across voice departures and rejoining", async () => {
	const f = fixture();
	try {
		await f.runtime.start();
		await setImmediate();
		const alice = f.first.members.get("111");
		const carol = f.member("333", "carol_account");
		f.first.members.set(carol.id, carol);
		f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, null), f.voiceState(carol, f.first));
		const original = f.post("801", alice, { content: "Original text" });
		f.client.emit(Events.MessageCreate, original);
		f.advance(100);
		f.first.members.delete(carol.id);
		f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, f.first), f.voiceState(carol, null));
		const edited = { ...original, content: "Private edited text", editedTimestamp: f.now() };
		f.client.emit(Events.MessageUpdate, original, edited);
		f.client.emit(Events.MessageUpdate, original, edited);
		f.client.emit(Events.MessageUpdate, edited, { ...edited, partial: true, content: "Do not fetch" });
		f.advance(50);
		f.first.members.delete(alice.id);
		f.client.emit(Events.VoiceStateUpdate, f.voiceState(alice, f.first), f.voiceState(alice, null));
		const absentAt = f.now();
		f.advance(50);
		f.first.members.set(alice.id, alice);
		f.client.emit(Events.VoiceStateUpdate, f.voiceState(alice, null), f.voiceState(alice, f.first));
		f.client.emit(Events.MessageUpdate, edited, { ...edited, content: "Edited while outside voice", editedTimestamp: absentAt });
		f.client.emit(Events.MessageBulkDelete, new Collection([[edited.id, edited]]));
		f.client.emit(Events.MessageDelete, edited);
		await f.runtime.stop();
		const records = f.records.filter((record) => record.messageId === "801");
		assert.deepEqual(records.map((r) => [r.type, r.text, r.audienceUserIds]), [
			["message_posted", "Original text", []],
			["message_edited", "Private edited text", []], ["message_edited", "Edited while outside voice", []], ["message_deleted", undefined, []],
		]);
		assert.equal(records[1].targetEventId, records[0].eventId);
		assert.equal(records[2].targetEventId, records[0].eventId);
		assert.equal(records[3].targetEventId, records[0].eventId);
		assert.equal(f.client.listenerCount(Events.MessageUpdate), 0);
	}
	finally { await f.runtime.stop(); }
});

test("channel exclusions persist, stop the excluded recording and cannot expand the operator allowlist", async () => {
	const f = fixture();
	f.config.channels = ["456"];
	try {
		await f.runtime.start();
		await f.runtime.exclude("456", true, "111");
		assert.equal(f.captures[0].closed, true);
		await assert.rejects(f.runtime.resume("456"), /excluded/);
		await f.runtime.exclude("457", false, "111");
		await assert.rejects(f.runtime.resume("457"), /not enabled/);
		await f.runtime.stop();
		const restarted = new TranscriptionRuntime(f.client, f.config, f.dependencies);
		await restarted.start();
		assert.match(restarted.status(), /Excluded channels:.*456/);
		assert.equal(f.captures.length, 1);
		await restarted.stop();
	}
	finally { await f.runtime.stop(); }
});

test("transcription uses the shared structured logger with guild context and no conversation text", async () => {
	const f = fixture();
	const logs = [];
	const unsubscribe = subscribeLogs((record) => logs.push(record));
	f.runtime = new TranscriptionRuntime(f.client, f.config, { ...f.dependencies, log: logger, transcribe: async () => "secret spoken content" });
	try {
		await f.runtime.start();
		await setImmediate();
		f.captures[0].packet("111", Buffer.alloc(640), f.now());
		f.client.emit(Events.MessageCreate, f.post("801", f.first.members.get("111"), { content: "secret posted content" }));
		await f.runtime.pause("111");
		await f.runtime.stop();
		assert.ok(logs.some((r) => r.level === "SUCCESS" && /recording started/.test(r.message)));
		assert.ok(logs.some((r) => r.level === "DEBUG" && /Transcript event saved/.test(r.message) && /text length/.test(r.message)));
		assert.ok(logs.some((r) => /requested by: "111"/.test(r.message)));
		assert.ok(logs.every((r) => r.guildId === "123"));
		assert.ok(!JSON.stringify(logs).includes("secret spoken content"));
		assert.ok(!JSON.stringify(logs).includes("secret posted content"));
	}
	finally { unsubscribe(); await f.runtime.stop(); }
});

test("an unavailable database does not prevent Discord login and local recording startup", async () => {
	const calls = [];
	const client = { destroy: async () => { calls.push("destroy"); } };
	const bot = await startBot({
		validateEnvironment: () => undefined, createClient: () => client,
		createTranscriptionRuntime: () => ({ start: async () => { calls.push("transcription"); }, stop: async () => undefined }),
		createPGPool: async () => { throw new Error("private database password must never be logged"); }, closeDatabase: async () => undefined,
		commandHandler: async () => undefined, eventHandler: async () => undefined, drainEvents: async () => undefined,
		loginClient: async () => { calls.push("login"); }, startCronJobs: () => async () => undefined,
		logger: { info: () => undefined, error: (message) => { assert.ok(!message.includes("password")); } },
	});
	await bot.stop();
	assert.deepEqual(calls, ["login", "transcription", "destroy"]);
});

test("a simulated six-hour conversation preserves audiences through repeated membership changes and midnight", async () => {
	const f = fixture();
	const carol = f.member("333", "carol");
	try {
		f.advance(9 * 3_600_000);
		await f.runtime.start();
		await setImmediate();
		for (let minute = 0; minute < 360; minute++) {
			const capture = f.captures.at(-1);
			capture.packet("111", Buffer.alloc(640, 1), f.now());
			f.advance(100);
			f.first.members.set(carol.id, carol);
			f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, null), f.voiceState(carol, f.first));
			capture.packet("111", Buffer.alloc(640, 2), f.now());
			capture.packet("333", Buffer.alloc(640, 3), f.now());
			f.advance(100);
			f.first.members.delete(carol.id);
			f.client.emit(Events.VoiceStateUpdate, f.voiceState(carol, f.first), f.voiceState(carol, null));
			f.advance(59_800);
			await setImmediate();
		}
		await f.runtime.stop();
		const speech = f.records.filter((record) => record.type === "transcript");
		assert.equal(speech.length, 1080);
		assert.equal(f.records.filter((record) => record.type === "gap").length, 0);
		assert.ok(speech.every((record) => JSON.stringify(record.audienceUserIds) === JSON.stringify(record.text === "speech-1" ? ["111", "555"] : ["111", "555", "333"])));
		assert.ok(speech.some((record) => record.at.startsWith("2026-10-02")));
	}
	finally { await f.runtime.stop(); }
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
