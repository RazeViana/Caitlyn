/**
 * @file fxConnectionWatchdog.test.js
 * @description Verifies local listener loss, consecutive failures and cancellation during shutdown.
 * Uses temporary local sockets and fake probes; never contacts providers or Discord.
 *
 * @module fxConnectionWatchdog.test
 */

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { checkFxConnection, watchFxConnection } from "../scripts/deployment/fxConnectionWatchdog.mjs";

test("local probe detects listener loss without making HTTP requests", async () => {
	let bytes = 0;
	const server = createServer((socket) => {
		socket.on("data", (data) => { bytes += data.length; });
		socket.end();
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	assert.equal(await checkFxConnection(origin), true);
	await new Promise((resolve) => server.close(resolve));
	assert.equal(bytes, 0);
	assert.equal(await checkFxConnection(origin), false);
	assert.throws(() => checkFxConnection("http://example.com:8787"));
});

test("persistent loss requests one restart; recovery resets failure count", async () => {
	let calls = 0;
	let restarts = 0;
	let done;
	const finished = new Promise((resolve) => { done = resolve; });
	const stop = watchFxConnection({ origin: "http://127.0.0.1:8787", intervalMs: 5,
		probe: async () => { calls++; return calls === 3; },
		onUnavailable: () => { restarts++; done(); } });
	try {
		await Promise.race([finished, delay(1_000).then(() => { throw new Error("watchdog timed out"); })]);
		await delay(20);
		assert.equal(calls, 6);
		assert.equal(restarts, 1);
	}
	finally { stop(); }
});

test("shutdown ignores an in-flight failed probe", async () => {
	let release;
	let started;
	const ready = new Promise((resolve) => { started = resolve; });
	let restarts = 0;
	const stop = watchFxConnection({ origin: "http://127.0.0.1:8787", intervalMs: 5, failuresBeforeRestart: 1,
		probe: () => {
			started();
			return new Promise((resolve) => { release = resolve; });
		},
		onUnavailable: () => { restarts++; } });
	await Promise.race([ready, delay(1_000).then(() => { throw new Error("probe did not start"); })]);
	stop();
	release(false);
	await delay(20);
	assert.equal(restarts, 0);
});
