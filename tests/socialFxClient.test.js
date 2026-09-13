/**
 * @file socialFxClient.test.js
 * @description Exercises the local FxEmbed HTTP boundary with synthetic responses and no external requests.
 * Verifies fixed destinations, bounded bytes, cancellation, and content-free failures.
 *
 * @module socialFxClient.test
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { createFxEmbedClient, FX_HOST, FX_METADATA_LIMIT } from "../scripts/socialWorker/fxEmbedClient.ts";
import { parseXMetadataProvider } from "../scripts/socialWorker/runner.ts";

async function fixture(context, handler, timeout = 1000, apiKey) {
	const server = createServer(handler);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	context.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	});
	return createFxEmbedClient("http://127.0.0.1:" + server.address().port, timeout, apiKey);
}

test("the broker sends only its separate local API key, never X cookies, and rejects injected keys", async (context) => {
	const key = "e".repeat(64);
	const client = await fixture(context, (request, response) => {
		assert.equal(request.headers["x-caitlyn-key"], key);
		assert.equal(request.headers.cookie, undefined);
		assert.equal(request.headers.authorization, undefined);
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end("{}");
	}, 1000, key);
	assert.equal((await client("123", new AbortController().signal)).outcome, "received");
	for (const invalid of ["", "secret\r\nCookie: injected", "x".repeat(64), 42]) assert.throws(() => createFxEmbedClient(undefined, 1000, invalid));
});

test("FxEmbed is the sole default provider and remote or ambiguous origins fail before I/O", () => {
	assert.equal(parseXMetadataProvider(), "fxembed");
	assert.equal(parseXMetadataProvider("fxembed"), "fxembed");
	for (const value of ["direct", "vxtwitter", "", null, "https://api.fxtwitter.com"]) assert.throws(() => parseXMetadataProvider(value));
	for (const value of ["https://api.fxtwitter.com", "http://localhost:8787", "http://127.1:8787", "http://127.0.0.1:8787/private",
		"http://user@127.0.0.1:8787", "http://127.0.0.1:8787?x=y", "http://127.0.0.1:99999", "http://[::1]:8787"]) {
		assert.throws(() => createFxEmbedClient(value));
	}
});

test("FxEmbed receives only a fixed post ID path and honest application headers", async (context) => {
	let calls = 0;
	const client = await fixture(context, (request, response) => {
		calls++;
		assert.equal(request.url, "/2/status/123");
		assert.equal(request.headers.host, FX_HOST);
		assert.match(request.headers["user-agent"], /^Caitlyn\//);
		assert.equal(request.headers.cookie, undefined);
		assert.equal(request.headers.authorization, undefined);
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ code: 200, status: {} }));
	});
	const result = await client("123", new AbortController().signal);
	assert.equal(result.outcome, "received");
	assert.equal(result.payload.code, 200);
	for (const id of ["0", "../123", "123?include=secret", 123, "1".repeat(26)]) assert.equal((await client(id, new AbortController().signal)).outcome, "invalid_response");
	assert.equal(calls, 1);
});

test("HTTP denials, rate limits, server failures and redirects produce closed outcomes without fallback", async (context) => {
	let status = 401;
	let calls = 0;
	const client = await fixture(context, (_request, response) => {
		calls++;
		response.writeHead(status, { Location: "https://evil.test/secret" });
		response.end("private token and text");
	});
	for (const [code, outcome] of [[401, "restricted"], [403, "restricted"], [404, "unavailable"], [429, "rate_limited"],
		[500, "worker_unavailable"], [302, "invalid_response"]]) {
		status = code;
		assert.deepEqual(await client("123", new AbortController().signal), { outcome });
	}
	assert.equal(calls, 6);
});

test("FxEmbed rejects HTML, malformed JSON, oversized declared bodies and chunked overflow", async (context) => {
	let selected = 0;
	const client = await fixture(context, (_request, response) => {
		response.writeHead(200, { "Content-Type": selected === 0 ? "text/html" : "application/json",
			...(selected === 2 ? { "Content-Length": FX_METADATA_LIMIT + 1 } : {}) });
		response.end(selected === 3 ? "x".repeat(FX_METADATA_LIMIT + 1) : selected === 0 ? "<html>secret</html>" : "bad secret JSON");
	});
	for (selected = 0; selected < 4; selected++) assert.deepEqual(await client("123", new AbortController().signal), { outcome: "invalid_response" });
});

test("FxEmbed deadlines and caller cancellation close pending requests", async (context) => {
	const client = await fixture(context, () => undefined, 25);
	assert.deepEqual(await client("123", new AbortController().signal), { outcome: "timeout" });
	const controller = new AbortController();
	const pending = client("123", controller.signal);
	controller.abort();
	assert.deepEqual(await pending, { outcome: "timeout" });
	assert.deepEqual(await client("123", controller.signal), { outcome: "timeout" });
});

test("FxEmbed disconnected and truncated responses fail without leaking transport errors", async (context) => {
	const client = await fixture(context, (_request, response) => {
		response.writeHead(200, { "Content-Type": "application/json", "Content-Length": 100 });
		response.write("{");
		setImmediate(() => { response.destroy(); });
	});
	assert.deepEqual(await client("123", new AbortController().signal), { outcome: "worker_unavailable" });
});
