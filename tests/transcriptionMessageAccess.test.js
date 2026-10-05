/**
 * @file transcriptionMessageAccess.test.js
 * @description Verifies chat permissions without voice attendance, invalidation races and independent message capture.
 * @module transcriptionMessageAccess.test
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { ChannelType, Collection, Events, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { canReadMessageChannel, TranscriptionMessageAccess } from "../core/transcriptionMessageAccess.ts";
import { TranscriptionMessages } from "../core/transcriptionMessages.ts";
import { createDiscordLogForwarder, logForwarders } from "../core/discordLogForwarder.ts";

const read = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;

const logSettings = (channelId) => ({ guild_id: "123", log_channel_id: channelId, log_scope: "console", log_levels: ["INFO"] });

function installLogForwarder(context, client, channelId = "901") {
	const forwarder = createDiscordLogForwarder(client, {
		settings: { list: async () => [logSettings(channelId)] }, subscribe: () => () => undefined,
		send: async () => undefined, diagnostic: () => undefined,
	});
	logForwarders.set(client, forwarder);
	context.after(async () => {
		logForwarders.delete(client);
		await forwarder.stop();
	});
	return forwarder;
}

function fixture() {
	const logs = [];
	const members = new Collection(["111", "222", "999"].map((id) => [id, { id, user: { id, bot: id === "999" } }]));
	const channels = new Collection();
	const guild = { id: "123", available: true,
		members: { cache: members, me: members.get("999"), fetch: async () => new Collection(members) },
		roles: { fetch: async () => new Collection() },
		channels: { cache: channels, fetch: async (id) => id ? channels.get(id) : channels, fetchActiveThreads: async () => ({ threads: new Collection() }) },
	};
	const channel = (id, grants) => ({ id, name: id, guild, type: ChannelType.GuildText, isTextBased: () => true, isThread: () => false,
		permissionsFor: (member) => new PermissionsBitField(grants[member.id] ?? 0n) });
	channels.set("900", channel("900", { "111": read, "222": read, "999": read }));
	channels.set("901", channel("901", { "111": read, "999": read }));
	let ready = true;
	let snapshots = [];
	let broken = false;
	const calls = [];
	const query = async (sql, values = []) => {
		calls.push(sql);
		if (broken) throw Error("offline");
		if (sql.startsWith("SELECT DISTINCT")) return { rows: [] };
		if (sql.startsWith("DELETE")) snapshots = [];
		if (sql.startsWith("INSERT")) snapshots = JSON.parse(values[1]);
		return { rows: [] };
	};
	const database = { query, connect: async () => ({ query, release: () => undefined }) };
	const client = Object.assign(new EventEmitter(), { guilds: { cache: new Collection([[guild.id, guild]]) }, isReady: () => ready });
	const access = new TranscriptionMessageAccess(client, database, guild.id, { warn: (text) => logs.push(text), info: (text) => logs.push(text) });
	return { access, client, guild, channels, members, logs, calls, snapshots: () => snapshots,
		setReady: (value) => { ready = value; },
		setBroken: (value) => { broken = value; } };
}

test("channel visibility needs View Channel and history; private threads also need membership or Manage Threads", () => {
	const member = { id: "111" };
	const thread = { type: ChannelType.PrivateThread, members: { cache: new Collection() }, permissionsFor: () => new PermissionsBitField(read) };
	assert.equal(canReadMessageChannel(thread, member), false);
	thread.members.cache.set(member.id, {});
	assert.equal(canReadMessageChannel(thread, member), true);
	thread.members.cache.clear();
	thread.permissionsFor = () => new PermissionsBitField(read | PermissionFlagsBits.ManageThreads);
	assert.equal(canReadMessageChannel(thread, member), true);
	thread.permissionsFor = () => new PermissionsBitField(PermissionFlagsBits.ViewChannel);
	assert.equal(canReadMessageChannel(thread, member), false);
	thread.permissionsFor = () => null;
	assert.equal(canReadMessageChannel(thread, member), false);
});

test("the bot publishes channel permissions for members outside voice and removes grants after permission changes", async (context) => {
	const f = fixture();
	context.after(() => f.access.stop());
	await f.access.start();
	assert.deepEqual(f.snapshots(), [{ channel_id: "900", user_ids: ["111", "222"] }, { channel_id: "901", user_ids: ["111"] }]);
	assert.equal(f.access.healthy, true);
	f.channels.get("900").permissionsFor = (member) => new PermissionsBitField(member.id === "222" ? 0n : read);
	f.client.emit(Events.ChannelUpdate, f.channels.get("900"), f.channels.get("900"));
	await setImmediate();
	assert.deepEqual(f.snapshots(), []);
	await f.access.sync();
	assert.deepEqual(f.snapshots()[0].user_ids, ["111"]);
	f.members.delete("111");
	f.client.emit(Events.GuildMemberRemove, { id: "111", guild: f.guild });
	await f.access.sync();
	assert.ok(f.snapshots().every((row) => row.user_ids.length === 0));
	f.client.emit(Events.ChannelDelete, f.channels.get("901"));
	await f.access.sync();
	assert.ok(!f.snapshots().some((row) => row.channel_id === "901"));
});

test("a permission change during hydration cannot republish stale grants; disconnects clear access", async (context) => {
	const f = fixture();
	context.after(() => f.access.stop());
	let release;
	const gate = new Promise((resolve) => { release = resolve; });
	let fetching;
	const began = new Promise((resolve) => { fetching = resolve; });
	f.guild.members.fetch = async () => {
		fetching();
		await gate;
		return new Collection(f.members);
	};
	const starting = f.access.start();
	await began;
	f.members.delete("222");
	f.client.emit(Events.GuildMemberRemove, { id: "222", guild: f.guild });
	release();
	await starting;
	await f.access.sync();
	assert.ok(f.snapshots().every((row) => !row.user_ids.includes("222")));
	f.setReady(false);
	f.client.emit(Events.ShardDisconnect);
	await setImmediate();
	assert.deepEqual(f.snapshots(), []);
	assert.equal(f.access.healthy, false);
});

test("private-thread refresh discovers uncached membership and removes departed thread members", async (context) => {
	const f = fixture();
	context.after(() => f.access.stop());
	const thread = { ...f.channels.get("900"), id: "902", type: ChannelType.PrivateThread, isThread: () => true,
		members: { cache: new Collection([["111", {}]]), fetch: async () => {
			const fresh = new Collection([["222", {}], ["999", {}]]);
			for (const [id, member] of fresh) thread.members.cache.set(id, member);
			return fresh;
		} } };
	f.channels.set(thread.id, thread);
	await f.access.start();
	assert.deepEqual(f.snapshots().find((row) => row.channel_id === "902")?.user_ids, ["222"]);
});

test("permission refresh failures are bounded operational logs and never silently mark access healthy", async (context) => {
	const f = fixture();
	context.after(() => f.access.stop());
	f.setBroken(true);
	await f.access.start();
	await f.access.sync();
	assert.equal(f.access.healthy, false);
	assert.equal(f.logs.length, 1);
	f.setBroken(false);
	await f.access.sync();
	assert.equal(f.access.healthy, true);
	assert.match(f.logs[1], /recovered/);
});

test("archive visibility excludes the configured log channel and uncached-parent threads, including old stored logs", async (context) => {
	const f = fixture();
	context.after(() => f.access.stop());
	const forwarder = installLogForwarder(context, f.client);
	await forwarder.refresh();
	const thread = { ...f.channels.get("901"), id: "902", parentId: "901", parent: null,
		type: ChannelType.PublicThread, isThread: () => true };
	f.channels.set(thread.id, thread);
	await f.access.start();
	assert.deepEqual(f.snapshots().map((row) => row.channel_id), ["900"]);
	forwarder.update(logSettings("900"));
	await f.access.sync();
	assert.deepEqual(f.snapshots().map((row) => row.channel_id), ["901", "902"]);
});

test("log-channel posts, edits and partial or bulk deletions are ignored while normal bot messages are captured", async (context) => {
	const client = Object.assign(new EventEmitter(), { isReady: () => true });
	const forwarder = installLogForwarder(context, client);
	await forwarder.refresh();
	const records = [];
	const references = [];
	const messages = new TranscriptionMessages(client, "123", async (record) => { records.push(record); }, () => true,
		async (id) => { references.push(id); }, () => 3000);
	context.after(() => messages.stop());
	const post = (id, channelId, parentId) => ({ id, author: { id: "999", username: "Caitlyn", bot: true }, guildId: "123", channelId,
		channel: { name: "channel", parent: null, parentId, isThread: () => Boolean(parentId) },
		system: false, createdTimestamp: 1000, editedTimestamp: 2000, content: "A message", attachments: new Collection(),
		inGuild: () => true, url: `https://discord.com/channels/123/${channelId}/${id}` });
	messages.start();
	for (const message of [post("801", "901"), post("802", "902", "901")]) {
		client.emit(Events.MessageCreate, message);
		client.emit(Events.MessageUpdate, {}, message);
		client.emit(Events.MessageDelete, { ...message, partial: true, author: null });
		client.emit(Events.MessageBulkDelete, new Collection([[message.id, message]]));
	}
	client.emit(Events.MessageCreate, post("803", "900"));
	await messages.stop();
	assert.deepEqual(references, []);
	assert.deepEqual(records.map((row) => row.messageId), ["803"]);
});

test("unknown log settings exclude chat until loaded, and setup changes fence queued revisions", async (context) => {
	const client = Object.assign(new EventEmitter(), { isReady: () => true });
	const forwarder = installLogForwarder(context, client);
	const records = [];
	let release;
	let began;
	const pending = new Promise((resolve) => { began = resolve; });
	const original = new Promise((resolve) => { release = resolve; });
	const messages = new TranscriptionMessages(client, "123", async (record) => { records.push(record); }, () => true,
		async () => { began(); return original; });
	context.after(() => messages.stop());
	const message = { id: "801", author: { id: "111", username: "account_name" }, guildId: "123", channelId: "900",
		channel: { name: "general", isThread: () => false }, system: false, createdTimestamp: 1000, editedTimestamp: 2000,
		content: "First edit", attachments: new Collection(), inGuild: () => true, url: "https://discord.com/channels/123/900/801" };
	messages.start();
	client.emit(Events.MessageCreate, message);
	await forwarder.refresh();
	client.emit(Events.MessageUpdate, {}, message);
	await pending;
	forwarder.update(logSettings("900"));
	release({ eventId: "original", userId: "111", speaker: "account_name" });
	await messages.stop();
	assert.deepEqual(records, []);
});

test("chat capture works without voice, keeps complete edit snapshots and reconnects revisions to stored originals", async () => {
	const client = new EventEmitter();
	const records = [];
	const references = [];
	const original = { eventId: "old-captured-id", userId: "111", speaker: "account_name" };
	const messages = new TranscriptionMessages(client, "123", async (record) => { records.push(record); }, () => true,
		async (id) => { references.push(id); return original; }, () => 3000);
	const message = { id: "801", author: { id: "111", username: "account_name" }, guildId: "123", channelId: "900",
		channel: { name: "general", isThread: () => false }, system: false, createdTimestamp: 1000, editedTimestamp: 2000,
		content: "First edit", attachments: new Collection(), inGuild: () => true, url: "https://discord.com/channels/123/900/801" };
	messages.start();
	client.emit(Events.MessageUpdate, {}, message);
	message.content = "Mutated cache must not replace the received edit";
	client.emit(Events.MessageDelete, { ...message, partial: true, author: null });
	client.emit(Events.MessageBulkDelete, new Collection([[message.id, message]]));
	await messages.stop();
	assert.deepEqual(references, ["801"]);
	assert.deepEqual(records.map((row) => [row.type, row.text, row.targetEventId]), [
		["message_edited", "First edit", "old-captured-id"], ["message_deleted", undefined, "old-captured-id"],
	]);
	assert.ok(records.every((row) => row.channelId === "900" && row.sessionId === "messages-900" && row.speaker === "account_name"));
	assert.equal(client.listenerCount(Events.MessageCreate), 0);
});
