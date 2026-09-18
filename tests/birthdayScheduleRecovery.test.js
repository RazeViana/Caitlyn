/**
 * @file birthdayScheduleRecovery.test.js
 * @description Tests coalesced missed-tick recovery, readiness deferral and scheduler diagnostic routing.
 * Uses synthetic task/client events without sending birthday messages or querying the database.
 *
 * @module birthdayScheduleRecoveryTests
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { Events } from "discord.js";
import { startBirthdayScheduledEvent } from "../jobs/birthdayScheduledEvent.ts";
import logger from "../core/logger.ts";

function fixture(context, reminder = async () => undefined) {
	context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date("2026-09-18T19:00:00Z") });
	const logs = [];
	for (const level of ["info", "warn", "error", "debug"]) context.mock.method(logger, level, (...args) => logs.push({ level, args }));
	const client = new EventEmitter();
	client.isReady = () => true;
	const task = new EventEmitter();
	let destroyed = false;
	task.destroy = async () => { destroyed = true; };
	task.start = () => { assert.equal(task.listenerCount("execution:missed"), 1); };
	let scheduled;
	let options;
	const calls = [];
	const stop = startBirthdayScheduledEvent(client, {
		info: logger.info,
		birthdayReminderMessage: async (_client, stopped) => {
			calls.push({ now: new Date(), stopped });
			await reminder();
		},
		schedule: (_expression, callback, selectedOptions) => {
			scheduled = callback;
			options = selectedOptions;
			return task;
		},
	});
	return { client, task, calls, logs, stop, scheduled, options, destroyed: () => destroyed };
}

test("many missed slots produce one current-day check and one shared warning", async (context) => {
	const f = fixture(context);
	await new Promise((resolve) => setImmediate(resolve));
	for (const date of ["2026-09-17T23:55:00Z", "2026-09-18T00:00:00Z", "2026-09-18T18:55:00Z"]) f.task.emit("execution:missed", { date: new Date(date) });
	context.mock.timers.tick(0);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.calls.length, 2);
	assert.ok(f.calls.every((call) => call.now.toISOString().startsWith("2026-09-18")));
	assert.equal(f.logs.filter((entry) => entry.level === "warn").length, 1);
	assert.match(f.logs.find((entry) => entry.level === "warn").args.join(" "), /Birthday check was delayed; checking today's birthdays now.*missed checks: 3/);
	assert.equal(f.options.noOverlap, true);
	await f.stop();
});

test("missed checks stay deferred while Discord is disconnected and recover on resume", async (context) => {
	const f = fixture(context);
	await new Promise((resolve) => setImmediate(resolve));
	f.client.isReady = () => false;
	f.task.emit("execution:missed", { date: new Date() });
	context.mock.timers.tick(0);
	await f.scheduled();
	context.mock.timers.tick(0);
	assert.equal(f.calls.length, 1);
	f.client.isReady = () => true;
	f.client.emit(Events.ShardResume, 0);
	context.mock.timers.tick(0);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.calls.length, 2);
	assert.match(f.logs.find((entry) => entry.level === "warn").args.join(" "), /missed checks: 2/);
	await f.stop();
	assert.equal(f.client.listenerCount(Events.ShardResume), 0);
	assert.equal(f.task.listenerCount("execution:missed"), 0);
});

test("missed recovery waits for active work and shutdown cancels queued recovery", async (context) => {
	let finish;
	let attempts = 0;
	const f = fixture(context, async () => {
		attempts++;
		if (attempts === 1) await new Promise((resolve) => { finish = resolve; });
	});
	f.task.emit("execution:missed", { date: new Date() });
	f.task.emit("execution:missed", { date: new Date() });
	context.mock.timers.tick(0);
	assert.equal(f.calls.length, 1);
	finish();
	await new Promise((resolve) => setImmediate(resolve));
	context.mock.timers.tick(0);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(f.calls.length, 2);
	f.task.emit("execution:missed", { date: new Date() });
	await f.stop();
	context.mock.timers.tick(0);
	assert.equal(f.calls.length, 2);
	assert.equal(f.destroyed(), true);
	assert.equal(f.calls[1].stopped(), true);
});

test("scheduler diagnostics use the shared logger without duplicating reminder errors", async (context) => {
	let fail = false;
	const failure = new Error("synthetic reminder failure");
	const f = fixture(context, async () => { if (fail) throw failure; });
	await new Promise((resolve) => setImmediate(resolve));
	f.options.logger.warn("synthetic overlap");
	f.options.logger.error(new Error("synthetic scheduler failure"));
	assert.match(f.logs.find((entry) => entry.level === "warn").args.join(" "), /Automatic birthday checks: synthetic overlap/);
	fail = true;
	await assert.rejects(f.scheduled(), failure);
	f.options.logger.error(failure);
	assert.equal(f.logs.filter((entry) => entry.level === "error").length, 2);
	await f.stop();
});
