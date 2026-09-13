/**
 * @file socialProgress.test.js
 * @description Checks expiring cooking feedback, request bounds, and timer cleanup without Discord access.
 * Uses fake clocks and controlled promises to cover failure, timeout, and late completion.
 *
 * @module socialProgress.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { startSocialProgress } from "../core/socialProgress.ts";

test("cooking feedback refreshes during work and stops immediately on completion", async (context) => {
	context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
	let calls = 0;
	let signal;
	const stop = startSocialProgress({ typing: async (received) => {
		signal = received;
		calls++;
	}, unavailable: () => assert.fail("unexpected failure") });
	assert.equal(calls, 1);
	await setImmediate();
	context.mock.timers.tick(8_000);
	await setImmediate();
	assert.equal(calls, 2);
	stop();
	assert.equal(signal.aborted, true);
	context.mock.timers.tick(30_000);
	await setImmediate();
	assert.equal(calls, 2);
});

test("slow typing requests never overlap and stop after a bounded timeout", async (context) => {
	context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
	let calls = 0;
	let warnings = 0;
	let resolve;
	const stop = startSocialProgress({ typing: () => {
		calls++;
		return new Promise((done) => { resolve = done; });
	},
	unavailable: () => { warnings++; }, refreshMs: 100, timeoutMs: 500 });
	context.mock.timers.tick(400);
	await setImmediate();
	assert.equal(calls, 1);
	context.mock.timers.tick(100);
	await setImmediate();
	assert.equal(warnings, 1);
	resolve();
	await setImmediate();
	context.mock.timers.tick(5_000);
	assert.equal(calls, 1);
	stop();
});

test("indicator failures do not retry or reject the caller and do not expose raw errors", async (context) => {
	context.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
	let calls = 0;
	let warnings = 0;
	const stop = startSocialProgress({ typing: async () => {
		calls++;
		throw new Error("private request data");
	}, unavailable: () => { warnings++; } });
	await setImmediate();
	context.mock.timers.tick(30_000);
	await setImmediate();
	assert.equal(calls, 1);
	assert.equal(warnings, 1);
	stop();
});
