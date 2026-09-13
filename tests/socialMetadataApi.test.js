/**
 * @file socialMetadataApi.test.js
 * @description Tests the owned, metadata-only API, safe CDN fields, liveness, and separation from delivery.
 * Injects extraction and uses temporary private sockets; no providers, Docker, or Discord are contacted.
 *
 * @module socialMetadataApi.test
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { startSocialWorkerServer } from "../scripts/socialWorker/server.ts";
import { normalizeXPost } from "../core/socialXPost.ts";
import { xWorkerArguments } from "../scripts/socialWorker/runner.ts";
import { decodeSocialMetadataResult, decodeSocialWorkerResult, requestSocialMetadata, requestSocialWorker, validateSocialMetadataRequest,
	SOCIAL_FILE_LIMIT, SOCIAL_METADATA_LIMIT, SOCIAL_TOTAL_LIMIT } from "../core/socialWorkerClient.ts";

const input = { version: 1, url: "https://x.com/alice/status/123" };
const deliveryInput = { ...input, attachmentBytes: SOCIAL_FILE_LIMIT, totalBytes: SOCIAL_TOTAL_LIMIT };

function metadata() {
	return { version: 1, purpose: "metadata", provider: "fxembed", outcome: "ready", post: { id: "123", url: input.url,
		author: { name: "Alice", handle: "alice" }, text: "A public post", textComplete: true, issues: [],
		media: [{ id: "456", kind: "image", imageUrl: "https://pbs.twimg.com/media/fixture.jpg?name=small", variants: [] },
			{ id: "789", kind: "video", variants: [{ url: "https://video.twimg.com/ext_tw_video/789/clip.mp4?tag=1", bitrate: 256000, width: 640, height: 360 }], durationSeconds: 10 }] } };
}

async function server(context, run) {
	const directory = await mkdtemp("/tmp/caitlyn-metadata-");
	const socket = `${directory}/worker.sock`;
	const service = await startSocialWorkerServer(socket, run);
	context.after(async () => {
		await service.stop();
		await rm(directory, { recursive: true, force: true });
	});
	return socket;
}

function raw(socketPath, method, endpoint, body) {
	return new Promise((resolve, reject) => {
		const op = request({ socketPath, method, path: endpoint, headers: { "Content-Type": "application/json" } }, (response) => {
			let output = "";
			response.on("data", (chunk) => { output += chunk; });
			response.on("end", () => { resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(output) }); });
		});
		op.on("error", reject);
		op.end(body === undefined ? undefined : JSON.stringify(body));
	});
}

test("metadata requests accept only a canonical X URL, version, and explicit sensitivity flag", () => {
	assert.deepEqual(validateSocialMetadataRequest(input), input);
	assert.deepEqual(validateSocialMetadataRequest({ ...input, allowSensitive: true }), { ...input, allowSensitive: true });
	for (const changes of [{ url: "http://127.0.0.1" }, { url: `${input.url}?x=1` }, { url: "https://vxtwitter.com/alice/status/123" },
		{ version: 2 }, { provider: "vxtwitter" }, { operation: "delivery" }, { headers: {} }, { cookies: "secret" },
		{ attachmentBytes: 1024 }, { allowSensitive: "true" }]) assert.throws(() => validateSocialMetadataRequest({ ...input, ...changes }));
});

test("metadata-only worker invocation never includes delivery budgets or a hosted provider", () => {
	assert.deepEqual(xWorkerArguments(deliveryInput, "fxembed", "metadata"), []);
	assert.deepEqual(xWorkerArguments({ ...deliveryInput, allowSensitive: true }, "fxembed", "metadata"), []);
	assert.equal(xWorkerArguments(deliveryInput, "fxembed", "delivery")[0], "--deliver-x");
	assert.throws(() => xWorkerArguments(deliveryInput, "fxembed", "shell"), /invalid_worker_operation/);
});

test("metadata returns validated public CDN URLs but cannot be used as a successful delivery payload", () => {
	const result = metadata();
	result.secret = "private debug text";
	result.post.media[0].headers = { Cookie: "secret" };
	const cleaned = decodeSocialMetadataResult(result, input);
	assert.equal(cleaned.outcome, "ready");
	assert.equal(cleaned.post.media[0].imageUrl, "https://pbs.twimg.com/media/fixture.jpg?name=orig");
	assert.equal(cleaned.post.media[1].variants.length, 1);
	assert.ok(!JSON.stringify(cleaned).includes("secret"));
	assert.deepEqual(decodeSocialWorkerResult({ ...result, files: [] }, deliveryInput), { outcome: "invalid_response" });
	assert.deepEqual(decodeSocialMetadataResult({ ...result, purpose: "delivery" }, input), { outcome: "invalid_response" });
	assert.deepEqual(decodeSocialMetadataResult({ ...result, files: [] }, input), { outcome: "invalid_response" });
});

test("metadata rejects hostile hosts, malformed identities/variants/dimensions, and hosted-provider payloads", () => {
	for (const mutate of [
		(value) => { value.provider = "vxtwitter"; }, (value) => { value.purpose = ["metadata"]; },
		(value) => { value.post.id = "999"; }, (value) => { value.post.media[0].kind = ["image"]; },
		(value) => { value.post.media[0].imageUrl = "https://127.0.0.1/private.jpg"; },
		(value) => { value.post.media[1].variants[0].url = "https://video.twimg.com.evil.test/a.mp4"; },
		(value) => { value.post.media[1].variants[0].url = "https://video.twimg.com/../a.mp4"; },
		(value) => { value.post.media[1].variants = Array(33).fill(value.post.media[1].variants[0]); },
		(value) => { value.post.media[1].variants = []; },
		(value) => { value.post.media[1].variants[0].bitrate = "256000"; },
		(value) => { value.post.media[1].width = NaN; }, (value) => { value.post.media[1].height = -1; },
	]) {
		const result = metadata();
		mutate(result);
		assert.deepEqual(decodeSocialMetadataResult(result, input), { outcome: "invalid_response" });
	}
});

test("metadata preserves quote attribution and sensitivity without silently claiming completeness", () => {
	const result = metadata();
	result.post.quote = { state: "available", post: { ...metadata().post, id: "999", url: "https://x.com/bob/status/999", author: { name: "Bob", handle: "bob" }, sensitive: true } };
	assert.equal(decodeSocialMetadataResult(result, input).outcome, "restricted");
	assert.equal(decodeSocialMetadataResult(result, { ...input, allowSensitive: true }).post.quote.post.author.name, "Bob");
	result.post.quote.post.issues.push("incomplete_text");
	assert.equal(decodeSocialMetadataResult(result, { ...input, allowSensitive: true }).outcome, "partial");
	result.post.quote.post.quote = { state: "unavailable", id: "111" };
	assert.equal(decodeSocialMetadataResult(result, { ...input, allowSensitive: true }).outcome, "invalid_response");
});

test("private API routes metadata separately, uses no-store, and sanitizes its response before sending", async (context) => {
	const calls = [];
	const socket = await server(context, async (value, _signal, operation) => {
		calls.push({ value, operation });
		return { ...metadata(), secret: "must not escape" };
	});
	const result = await requestSocialMetadata(socket, input);
	assert.equal(result.outcome, "ready");
	assert.equal(result.files, undefined);
	assert.equal(calls[0].operation, "metadata");
	const wire = await raw(socket, "POST", "/v1/x/metadata", input);
	assert.equal(wire.status, 200);
	assert.equal(wire.headers["cache-control"], "no-store");
	assert.equal(wire.body.secret, undefined);
	for (const body of [{ ...input, provider: "vxtwitter" }, { ...input, allowSensitive: "true" }]) {
		assert.equal((await raw(socket, "POST", "/v1/x/metadata", body)).status, 502);
	}
	assert.equal(calls.length, 2);
	assert.equal((await raw(socket, "POST", "/v1/x/metadata?provider=vxtwitter", input)).status, 400);
});

test("metadata failures retain safe diagnostics through both API validation boundaries", async (context) => {
	const restricted = normalizeXPost({ tweetResult: { result: { __typename: "TweetUnavailable", reason: "NsfwLoggedOut" } } }, "123");
	const socket = await server(context, async () => ({ ...restricted, purpose: "metadata", provider: "fxembed", privateText: "secret" }));
	assert.deepEqual(await requestSocialMetadata(socket, input), { ...restricted, provider: "fxembed" });
});

test("health is a cheap local liveness check, works while busy, and never triggers provider work", async (context) => {
	let release;
	let active = false;
	const socket = await server(context, async () => {
		active = true;
		await new Promise((resolve) => { release = resolve; });
		return metadata();
	});
	const idle = await raw(socket, "GET", "/v1/health");
	assert.equal(idle.body.status, "idle");
	assert.equal(idle.body.hostedMetadataEnabled, false);
	assert.equal(active, false);
	const work = requestSocialMetadata(socket, input);
	while (!active) await setImmediate();
	assert.equal((await raw(socket, "GET", "/v1/health")).body.status, "busy");
	assert.equal((await requestSocialWorker(socket, deliveryInput)).outcome, "worker_unavailable");
	release();
	assert.equal((await work).outcome, "ready");
});

test("metadata transport bounds response bytes, timeouts, and cancellation", async (context) => {
	const directory = await mkdtemp("/tmp/caitlyn-metadata-wire-");
	const socket = `${directory}/worker.sock`;
	const service = createServer((incoming, response) => {
		incoming.resume();
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end("x".repeat(SOCIAL_METADATA_LIMIT + 1));
	});
	await new Promise((resolve) => { service.listen(socket, resolve); });
	context.after(async () => {
		service.closeAllConnections();
		await new Promise((resolve) => { service.close(resolve); });
		await rm(directory, { recursive: true, force: true });
	});
	assert.equal((await requestSocialMetadata(socket, input)).outcome, "invalid_response");
	const controlled = await server(context, async (_value, signal) => {
		await new Promise((resolve) => { signal.addEventListener("abort", resolve, { once: true }); });
		return { outcome: "timeout", purpose: "metadata", provider: "fxembed" };
	});
	assert.equal((await requestSocialMetadata(controlled, input, undefined, 20)).outcome, "timeout");
	const controller = new AbortController();
	controller.abort();
	assert.equal((await requestSocialMetadata(controlled, input, controller.signal)).outcome, "timeout");
});
