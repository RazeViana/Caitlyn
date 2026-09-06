/**
 * @file birthdayRecovery.test.js
 * @description Exercises birthday catch-up, delivery uncertainty, timezone boundaries, and scoped logs.
 * Uses synthetic delivery state and Discord substitutes without contacting live services.
 *
 * @module birthdayRecovery.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Collection, ChannelType } from "discord.js";
import { birthdayTimezone, birthdayWindow } from "../core/birthdayClock.ts";
import { createBirthdayReminder } from "../messages/birthdayReminderMessage.ts";
import { birthdayPayload, birthdayReference, getBirthdayChannel } from "../messages/birthdayDelivery.ts";
import { subscribeLogs } from "../core/logger.ts";
import { startBirthdayScheduledEvent } from "../jobs/birthdayScheduledEvent.ts";

function fixture(context) {
	for (const method of ["log", "warn", "error"]) context.mock.method(console, method, () => undefined);
	const logs = [];
	context.after(subscribeLogs((record) => logs.push(record)));
	const row = {
		id: "d9c63310-cf1b-442f-92a8-a0698a581479", guild_id: "123", channel_id: "456", occurrence_date: "2026-09-06",
		status: "ready", attempts: 0, started_at: null, recipient_ids: ["111", "222"],
	};
	const calls = { sends: 0, finds: 0, prepares: 0, defers: 0, releases: 0 };
	const client = { isReady: () => true };
	const channel = {
		send: async () => { calls.sends++; return "789"; },
		find: async () => { calls.finds++; return undefined; },
	};
	const store = {
		prepare: async () => { calls.prepares++; return { created: 0, expired: 0 }; },
		pending: async (_guild, date) => row.occurrence_date === date && !["sent", "expired"].includes(row.status) ? [structuredClone(row)] : [],
		claim: async () => {
			if (row.status !== "ready") return false;
			row.status = "sending";
			return true;
		},
		claimRecovery: async () => { row.status = "uncertain"; return true; },
		sent: async () => { row.status = "sent"; return true; },
		defer: async () => { calls.defers++; },
		uncertain: async () => { if (row.status === "sending") row.status = "uncertain"; },
		releaseUnsent: async () => { calls.releases++; row.status = "ready"; },
	};
	const dependencies = {
		store, channel: async () => channel, now: () => new Date("2026-09-06T08:00:00Z"),
		timezone: () => "Europe/Brussels", guildId: () => "123", channelId: () => "456", deliveryTimeout: 100,
	};
	return { row, calls, client, channel, store, dependencies, logs, run: (stopped) => createBirthdayReminder(dependencies)(client, stopped) };
}

test("birthday windows use the selected timezone, including DST, midnight, year end, and leap day", () => {
	assert.equal(birthdayTimezone("Europe/Brussels"), "Europe/Brussels");
	assert.throws(() => birthdayTimezone("secret-invalid-zone"));
	for (const [instant, zone, date, due] of [
		["2026-09-06T06:59:59Z", "Europe/Brussels", "2026-09-06", false],
		["2026-09-06T07:00:00Z", "Europe/Brussels", "2026-09-06", true],
		["2026-09-06T21:59:59Z", "Europe/Brussels", "2026-09-06", true],
		["2026-09-06T22:00:00Z", "Europe/Brussels", "2026-09-07", false],
		["2026-03-29T07:00:00Z", "Europe/Brussels", "2026-03-29", true],
		["2026-10-25T07:00:00Z", "Europe/Brussels", "2026-10-25", false],
		["2026-10-25T08:00:00Z", "Europe/Brussels", "2026-10-25", true],
		["2027-01-01T00:00:00Z", "America/Los_Angeles", "2026-12-31", true],
		["2028-02-29T09:00:00Z", "UTC", "2028-02-29", true],
	]) assert.deepEqual(birthdayWindow(new Date(instant), zone), { date, due });
});

test("same-day catch-up is sent once across checks and restart with scoped shared logging", async (context) => {
	const f = fixture(context);
	f.store.prepare = async () => ({ created: 2, expired: 1 });
	await f.run();
	await f.run();
	assert.equal(f.calls.sends, 1);
	assert.equal(f.row.status, "sent");
	assert.ok(f.logs.every((record) => record.guildId === "123"));
	for (const level of ["DEBUG", "INFO", "WARN", "SUCCESS"]) assert.ok(f.logs.some((record) => record.level === level), level);
});

test("before 9 AM, disconnected, and stopping checks make no database or Discord calls", async (context) => {
	const f = fixture(context);
	f.dependencies.now = () => new Date("2026-09-06T06:59:59Z");
	await f.run();
	f.dependencies.now = () => new Date("2026-09-06T08:00:00Z");
	f.client.isReady = () => false;
	await f.run();
	f.client.isReady = () => true;
	await f.run(() => true);
	assert.equal(f.calls.prepares, 0);
	assert.equal(f.calls.sends, 0);
});

test("two workers cannot send the same claimed birthday batch", async (context) => {
	const f = fixture(context);
	await Promise.all([f.run(), f.run()]);
	assert.equal(f.calls.sends, 1);
});

test("database preparation or send-claim failure never sends an untracked announcement", async (context) => {
	const f = fixture(context);
	const original = f.store.prepare;
	f.store.prepare = async () => { throw new Error("database offline"); };
	await assert.rejects(f.run(), /database offline/);
	f.store.prepare = original;
	f.store.claim = async () => { throw new Error("claim commit uncertain"); };
	await assert.rejects(f.run(), /claim commit uncertain/);
	assert.equal(f.calls.sends, 0);
});

test("channel/permission failures back off before sending and recover on a later check", async (context) => {
	const f = fixture(context);
	f.dependencies.channel = async () => { throw new Error("Missing access"); };
	await f.run();
	assert.equal(f.calls.defers, 1);
	assert.equal(f.row.status, "ready");
	assert.equal(f.calls.sends, 0);
	f.dependencies.channel = async () => f.channel;
	await f.run();
	assert.equal(f.calls.sends, 1);
	assert.ok(f.logs.some((record) => record.level === "WARN" && /retry is delayed/.test(record.message)));
});

test("midnight during channel lookup prevents sending yesterday's birthday", async (context) => {
	const f = fixture(context);
	f.dependencies.channel = async () => {
		f.dependencies.now = () => new Date("2026-09-06T22:00:00Z");
		return f.channel;
	};
	await f.run();
	assert.equal(f.calls.sends, 0);
	assert.equal(f.row.status, "ready");
});

test("shutdown after claiming releases a definitely unsent batch for same-day recovery", async (context) => {
	const f = fixture(context);
	let stopping = false;
	const claim = f.store.claim;
	f.store.claim = async () => {
		stopping = true;
		return claim();
	};
	await f.run(() => stopping);
	assert.equal(f.calls.sends, 0);
	assert.equal(f.calls.releases, 1);
	assert.equal(f.row.status, "ready");
});

test("send failure is persisted as uncertain, then reconciled without a second send", async (context) => {
	const f = fixture(context);
	f.channel.send = async () => {
		f.calls.sends++;
		throw new Error("connection reset after request");
	};
	await f.run();
	assert.equal(f.row.status, "uncertain");
	assert.ok(f.logs.some((record) => record.level === "ERROR"));
	f.channel.find = async () => "789";
	await f.run();
	assert.equal(f.row.status, "sent");
	assert.equal(f.calls.sends, 1);
	assert.ok(f.logs.some((record) => /recovered an existing Discord message/.test(record.message)));
});

test("missing history match or history access failure never authorizes a resend", async (context) => {
	const f = fixture(context);
	f.row.status = "sending";
	await f.run();
	assert.equal(f.row.status, "uncertain");
	f.channel.find = async () => { throw new Error("history unavailable"); };
	await f.run();
	assert.equal(f.calls.sends, 0);
	assert.ok(f.logs.some((record) => /Automatic resend withheld/.test(record.message)));
	assert.ok(f.logs.some((record) => /reconciliation failed/.test(record.message)));
});

test("accepted send with a failed database acknowledgement recovers from history", async (context) => {
	const f = fixture(context);
	const sent = f.store.sent;
	f.store.sent = async () => { throw new Error("database offline after send"); };
	await f.run();
	assert.equal(f.row.status, "sending");
	assert.ok(f.logs.some((record) => /recording delivery failed/.test(record.message)));
	f.store.sent = sent;
	f.channel.find = async () => "789";
	await f.run();
	assert.equal(f.row.status, "sent");
	assert.equal(f.calls.sends, 1);
});

test("send deadline retains the claim and records a late success without a duplicate", async (context) => {
	const f = fixture(context);
	let resolveSend;
	f.channel.send = () => {
		f.calls.sends++;
		return new Promise((resolve) => { resolveSend = resolve; });
	};
	f.dependencies.deliveryTimeout = 5;
	await f.run();
	assert.equal(f.row.status, "uncertain");
	await f.run();
	assert.equal(f.calls.sends, 1);
	resolveSend("789");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.row.status, "sent");
});

test("payload groups 25 recipients within Discord limits and mentions only those recipients", async (context) => {
	const f = fixture(context);
	f.row.recipient_ids = Array.from({ length: 25 }, (_value, index) => `99999999999999999${String(index).padStart(2, "0")}`);
	const payload = birthdayPayload(f.row);
	assert.ok(payload.content.length <= 2000);
	assert.deepEqual(payload.allowedMentions, { parse: [], users: f.row.recipient_ids });
	assert.ok(payload.nonce.length <= 25);
	assert.equal(payload.enforceNonce, true);
	assert.ok(payload.content.endsWith(birthdayReference(f.row)));
});

function discordFixture(row) {
	const calls = [];
	const channel = {
		type: ChannelType.GuildText, guildId: row.guild_id,
		permissionsFor: () => ({ has: () => true }),
		send: async (payload) => { calls.push(payload); return { id: "789" }; },
		messages: { fetch: async () => new Collection() },
	};
	const guild = { channels: { fetch: async () => channel }, members: { fetchMe: async () => ({ id: "999" }) } };
	const client = { user: { id: "999" }, guilds: { fetch: async () => guild } };
	return { channel, client, calls };
}

test("Discord transport validates channel type, guild, and recovery permissions", async (context) => {
	const f = fixture(context);
	const d = discordFixture(f.row);
	const channel = await getBirthdayChannel(d.client, f.row);
	assert.equal(await channel.send(f.row), "789");
	d.channel.type = ChannelType.GuildVoice;
	await assert.rejects(getBirthdayChannel(d.client, f.row), /text channel/);
	d.channel.type = ChannelType.GuildText;
	d.channel.guildId = "other";
	await assert.rejects(getBirthdayChannel(d.client, f.row), /configured server/);
	d.channel.guildId = f.row.guild_id;
	d.channel.permissionsFor = () => ({ has: () => false });
	await assert.rejects(getBirthdayChannel(d.client, f.row), /Read Message History/);
});

test("history reconciliation recognizes only this bot's reference and has a 500-message cap", async (context) => {
	const f = fixture(context);
	const d = discordFixture(f.row);
	let page = 0;
	const marked = { id: "789", author: { id: "999" }, content: birthdayPayload(f.row).content, createdTimestamp: Date.now() };
	d.channel.messages.fetch = async () => {
		page++;
		if (page === 2) return new Collection([[marked.id, marked]]);
		return new Collection(Array.from({ length: 100 }, (_value, index) => {
			const id = String(1000 + index);
			return [id, { ...marked, id, author: { id: "different-bot" } }];
		}));
	};
	const channel = await getBirthdayChannel(d.client, f.row);
	assert.equal(await channel.find(f.row), "789");
	assert.equal(page, 2);
	page = 0;
	d.channel.messages.fetch = async () => {
		page++;
		return new Collection(Array.from({ length: 100 }, (_value, index) => {
			const id = String(page * 1000 + index);
			return [id, { ...marked, id, webhookId: "webhook" }];
		}));
	};
	assert.equal(await channel.find(f.row), undefined);
	assert.equal(page, 5);
});

test("startup recovery errors are logged and contained while subsequent checks can recover", async (context) => {
	const f = fixture(context);
	let callback;
	let attempts = 0;
	const stop = startBirthdayScheduledEvent(f.client, {
		info: () => undefined,
		schedule: (_expression, run) => { callback = run; return { destroy: () => undefined }; },
		birthdayReminderMessage: async () => { if (++attempts === 1) throw new Error("database offline"); },
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(f.logs.some((record) => record.level === "ERROR" && /retry on the next five-minute check/.test(record.message)));
	await callback();
	assert.equal(attempts, 2);
	await stop();
});
