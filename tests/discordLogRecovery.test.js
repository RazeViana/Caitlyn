/**
 * @file discordLogRecovery.test.js
 * @description Exercises exact log-loss accounting, bounded retries and late send acknowledgements.
 * Synthetic transports never connect to Discord, change settings, or write an archive.
 *
 * @module discordLogRecoveryTests
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createDiscordLogForwarder, LogDeliveryFailure } from "../core/discordLogForwarder.ts";

function fixture() {
	let receive;
	let now = 0;
	let behavior = async () => undefined;
	const calls = [];
	const diagnostics = [];
	const settings = { guild_id: "111", log_channel_id: "222", log_scope: "console", log_levels: ["INFO", "WARN", "ERROR", "SUCCESS"] };
	const client = { isReady: () => true };
	const forwarder = createDiscordLogForwarder(client, {
		settings: { list: async () => [settings] },
		subscribe: (listener) => {
			receive = listener;
			return () => { receive = undefined; };
		},
		now: () => now,
		deliveryTimeoutMs: 5,
		diagnostic: (message) => diagnostics.push(message),
		send: async (destination, content, nonce) => {
			calls.push({ destination, content, nonce });
			return behavior();
		},
	});
	return {
		forwarder, calls, diagnostics, settings, client,
		advance: (milliseconds) => { now += milliseconds; },
		send: (next) => { behavior = next; },
		log: (message, level = "INFO") => receive?.({ timestamp: "2026-09-18 00:00:00", level, message }),
	};
}

test("definitely-unsent batches retain every chunk, nonce and ordering with exponential retry delays", async () => {
	const f = fixture();
	await f.forwarder.refresh();
	f.send(async () => { throw new LogDeliveryFailure("retryable"); });
	for (let index = 0; index < 6; index++) f.log(`original-${index}`);
	await f.forwarder.flush();
	f.log("arrived-after-failure");
	f.advance(29999);
	await f.forwarder.flush();
	assert.equal(f.calls.length, 1);
	f.advance(1);
	await f.forwarder.flush();
	f.advance(59999);
	await f.forwarder.flush();
	assert.equal(f.calls.length, 2);
	f.advance(1);
	f.send(async () => undefined);
	await f.forwarder.flush();
	assert.equal(f.calls.length, 3);
	assert.equal(new Set(f.calls.map((call) => call.content)).size, 1);
	assert.equal(new Set(f.calls.map((call) => call.nonce)).size, 1);
	assert.equal(f.calls[0].nonce.length, 24);
	assert.match(f.calls[2].content, /original-0[\s\S]*original-5/);
	await f.forwarder.flush();
	assert.match(f.calls[3].content, /arrived-after-failure[\s\S]*Discord confirmed the logs were sent/);
	assert.doesNotMatch(f.calls[3].content, /Could not confirm|Could not send|dropped parts/);
	await f.forwarder.stop();
});

test("a six-chunk permanent failure reports six, while ambiguous failures report uncertainty without replay", async () => {
	for (const disposition of ["failed", "uncertain"]) {
		const f = fixture();
		await f.forwarder.refresh();
		f.send(async () => { throw new LogDeliveryFailure(disposition); });
		for (let index = 0; index < 6; index++) f.log(`original-${index}`);
		await f.forwarder.flush();
		f.advance(30000);
		f.send(async () => undefined);
		await f.forwarder.flush();
		assert.equal(f.calls.length, 2);
		assert.match(f.calls[1].content, disposition === "failed" ? /Could not send parts of the log: 6/ : /Could not confirm whether parts of the log were sent: 6/);
		assert.doesNotMatch(f.calls[1].content, /original-/);
		await f.forwarder.stop();
	}
});

test("timeout holds one pending batch; late success does not report false loss or duplicate it", async () => {
	const f = fixture();
	await f.forwarder.refresh();
	let finish;
	f.send(() => new Promise((resolve) => { finish = resolve; }));
	f.log("slow original");
	await f.forwarder.flush();
	f.log("queued while pending");
	f.advance(60000);
	await f.forwarder.flush();
	assert.equal(f.calls.length, 1);
	assert.match(f.diagnostics[0], /still waiting, without sending another copy\. Parts of the log waiting: 1/);
	finish();
	await new Promise((resolve) => setImmediate(resolve));
	f.send(async () => undefined);
	await f.forwarder.flush();
	assert.equal(f.calls.length, 2);
	assert.match(f.calls[1].content, /queued while pending[\s\S]*Discord confirmed the logs were sent/);
	assert.doesNotMatch(f.calls[1].content, /slow original|Could not confirm|Could not send/);
	await f.forwarder.stop();
});

test("a late rejection retries only proven non-delivery; arbitrary errors remain uncertain", async () => {
	for (const retryable of [true, false]) {
		const f = fixture();
		await f.forwarder.refresh();
		let rejectSend;
		f.send(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
		f.log("late original");
		await f.forwarder.flush();
		rejectSend(retryable ? new LogDeliveryFailure("retryable") : new Error("private transport diagnostic"));
		await new Promise((resolve) => setImmediate(resolve));
		f.advance(30000);
		f.send(async () => undefined);
		await f.forwarder.flush();
		assert.equal(f.calls.length, 2);
		if (retryable) {
			assert.equal(f.calls[0].content, f.calls[1].content);
		}
		else {
			assert.match(f.calls[1].content, /Could not confirm whether parts of the log were sent: 1/);
			assert.doesNotMatch(f.calls[1].content, /late original/);
		}
		assert.doesNotMatch(f.diagnostics.join(" "), /private transport diagnostic/);
		await f.forwarder.stop();
	}
});

test("retry exhaustion and retention expiry are bounded and preserve exact failed counts", async () => {
	for (const expire of [true, false]) {
		const f = fixture();
		await f.forwarder.refresh();
		f.send(async () => { throw new LogDeliveryFailure("retryable"); });
		for (let index = 0; index < 6; index++) f.log(`original-${index}`);
		await f.forwarder.flush();
		if (expire) {
			f.advance(900000);
			await f.forwarder.flush();
			assert.equal(f.calls.length, 1);
		}
		else {
			for (const milliseconds of [30000, 60000, 120000, 240000]) {
				f.advance(milliseconds);
				await f.forwarder.flush();
			}
			assert.equal(f.calls.length, 5);
		}
		f.advance(30000);
		f.send(async () => undefined);
		await f.forwarder.flush();
		assert.match(f.calls.at(-1).content, /Could not send parts of the log: 6/);
		await f.forwarder.stop();
	}
});

test("overflow while a retained batch waits never corrupts that batch or hides its counters", async () => {
	const f = fixture();
	await f.forwarder.refresh();
	f.log("retained-before-overflow");
	f.send(async () => { throw new LogDeliveryFailure("retryable"); });
	await f.forwarder.flush();
	for (let index = 0; index < 250; index++) f.log(`later-${index}`);
	f.advance(30000);
	f.send(async () => undefined);
	await f.forwarder.flush();
	assert.equal(f.calls[0].content, f.calls[1].content);
	await f.forwarder.flush();
	// The recovery confirmation itself occupies one slot in the still-full bounded queue.
	assert.match(f.calls[2].content, /Too many logs were waiting to be sent; dropped parts of the log: 51/);
	assert.doesNotMatch(f.calls[2].content, /Could not send|Could not confirm/);
	await f.forwarder.stop();
});

test("configuration changes fence retained batches and late failure callbacks", async () => {
	for (const pending of [true, false]) {
		const f = fixture();
		await f.forwarder.refresh();
		let finish;
		const failBeforeSend = async () => { throw new LogDeliveryFailure("retryable"); };
		f.send(pending ? () => new Promise((_resolve, reject) => { finish = reject; }) : failBeforeSend);
		f.log("old-private-destination");
		await f.forwarder.flush();
		f.forwarder.update({ ...f.settings, log_channel_id: "333" });
		if (pending) finish(new Error("old uncertain request"));
		await new Promise((resolve) => setImmediate(resolve));
		f.send(async () => undefined);
		f.log("new-destination");
		await f.forwarder.flush();
		assert.equal(f.calls[1].destination.log_channel_id, "333");
		assert.match(f.calls[1].content, /new-destination/);
		assert.doesNotMatch(f.calls[1].content, /old-private|Could not confirm|Could not send/);
		await f.forwarder.stop();
	}
});

test("disconnected clients buffer without sending and selected levels still filter loss notices", async () => {
	const f = fixture();
	await f.forwarder.refresh();
	f.forwarder.update({ ...f.settings, log_levels: ["ERROR"] });
	f.client.isReady = () => false;
	for (let index = 0; index < 250; index++) f.log(`selected-${index}`, "ERROR");
	await f.forwarder.flush();
	assert.equal(f.calls.length, 0);
	f.client.isReady = () => true;
	await f.forwarder.flush();
	assert.doesNotMatch(f.calls[0].content, /WARN|dropped parts/);
	assert.match(f.calls[0].content, /selected-50/);
	await f.forwarder.stop();
});
