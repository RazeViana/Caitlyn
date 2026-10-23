/**
 * @file fxPublicWatchdog.test.js
 * @description Checks bounded readiness requests, recovery thresholds and shutdown cancellation.
 * Uses a local HTTP server and simulated time without contacting providers or Discord.
 *
 * @module fxPublicWatchdog.test
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { checkPublicRuntime, watchPublicRuntime } from "../scripts/fxEmbedPublic/watchdog.mjs";

const flush = () => new Promise(setImmediate);

test("readiness requires a bounded, non-redirecting HTTP response from the expected service", async () => {
	const server = createServer((request, response) => {
		const route = request.url;
		if (route === "/hung-headers") return;
		if (route === "/redirect") {
			response.writeHead(302, { location: "/ready" });
			response.end(); return;
		}
		response.writeHead(route === "/error" ? 503 : 200, { "content-type": "application/json" });
		if (route === "/hung-body") {
			response.write("{"); return;
		}
		if (route === "/invalid") {
			response.end("invalid"); return;
		}
		response.end(JSON.stringify({ service: route === "/wrong-service" ? "other" : "caitlyn-fxembed-public", ready: route !== "/not-ready" }));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		for (const route of ["ready", "error", "invalid", "wrong-service", "not-ready", "redirect", "hung-headers", "hung-body"]) {
			const ready = await checkPublicRuntime({ timeoutMs: 100, fetcher: (url, options) => {
				assert.equal(url, "http://127.0.0.1:8787/healthz");
				return fetch(`http://127.0.0.1:${server.address().port}/${route}`, options);
			} });
			assert.equal(ready, route === "ready", route);
		}
	}
	finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});

test("startup grace and a successful probe prevent premature restarts; persistent failure requests one restart", async (context) => {
	context.mock.timers.enable({ apis: ["setTimeout"] });
	let calls = 0;
	let restarts = 0;
	const stop = watchPublicRuntime({ startupDelayMs: 60_000, intervalMs: 15_000,
		probe: async () => {
			calls++;
			if (calls === 4) throw new Error("local_failure");
			return calls === 3;
		},
		onUnavailable: () => { restarts++; },
	});
	try {
		context.mock.timers.tick(59_999);
		await flush();
		assert.equal(calls, 0);
		context.mock.timers.tick(1);
		await flush();
		for (let count = 2; count <= 6; count++) {
			assert.equal(restarts, 0);
			context.mock.timers.tick(15_000);
			await flush();
			assert.equal(calls, count);
		}
		assert.equal(restarts, 1);
		context.mock.timers.tick(300_000);
		await flush();
		assert.equal(calls, 6);
		assert.equal(restarts, 1);
	}
	finally { stop(); }
});

test("shutdown cancels startup and ignores an in-flight failed readiness probe", async (context) => {
	context.mock.timers.enable({ apis: ["setTimeout"] });
	let calls = 0;
	let restarts = 0;
	let release;
	const options = { startupDelayMs: 60_000, failuresBeforeRestart: 1,
		probe: () => {
			calls++;
			return new Promise((resolve) => { release = resolve; });
		},
		onUnavailable: () => { restarts++; },
	};
	const beforeStart = watchPublicRuntime(options);
	beforeStart();
	context.mock.timers.tick(60_000);
	await flush();
	assert.equal(calls, 0);
	const duringProbe = watchPublicRuntime(options);
	context.mock.timers.tick(60_000);
	assert.equal(calls, 1);
	duringProbe();
	release(false);
	await flush();
	context.mock.timers.tick(300_000);
	await flush();
	assert.equal(restarts, 0);
	assert.equal(calls, 1);
});
