/**
 * @file socialWorkerTransport.test.js
 * @description Checks owner-only Unix transport, bounded payload validation, busy handling, and cancellation.
 * Uses an injected worker and synthetic bytes without Docker, remote providers, or Discord.
 *
 * @module socialWorkerTransport.test
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, lstat, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { startSocialWorkerServer } from "../scripts/socialWorker/server.ts";
import { decodeSocialWorkerResult, requestSocialWorker, validateSocialWorkerRequest, SOCIAL_FILE_LIMIT, SOCIAL_TOTAL_LIMIT } from "../core/socialWorkerClient.ts";
import { normalizeXPost } from "../core/socialXPost.ts";

const input = { version: 1, url: "https://x.com/alice/status/123", attachmentBytes: SOCIAL_FILE_LIMIT, totalBytes: SOCIAL_TOTAL_LIMIT };

function wire(size = 16) {
	const data = Buffer.alloc(size);
	Buffer.from("89504e470d0a1a0a", "hex").copy(data);
	return { version: 1, outcome: "ready", post: { id: "123", url: input.url, author: { name: "Alice", handle: "alice" },
		text: "hello", textComplete: true, issues: [], media: [{ id: "456", kind: "image", imageUrl: "https://untrusted.test/file", variants: [] }] },
	files: [{ postId: "123", mediaId: "456", extension: "png", base64: data.toString("base64"), sha256: createHash("sha256").update(data).digest("hex") }] };
}

async function service(context, run) {
	const directory = await mkdtemp("/tmp/caitlyn-wire-");
	const socket = `${directory}/worker.sock`;
	const server = await startSocialWorkerServer(socket, run);
	context.after(async () => {
		await server.stop();
		assert.equal(await lstat(socket).catch(() => undefined), undefined);
		await rm(directory, { recursive: true, force: true });
	});
	return socket;
}

function raw(socketPath, body, headers = {}) {
	return new Promise((resolve, reject) => {
		const operation = request({ socketPath, path: "/v1/x", method: "POST", headers: { "Content-Type": "application/json", ...headers } }, (response) => {
			response.resume();
			response.once("end", () => { resolve(response.statusCode); });
		});
		operation.on("error", reject);
		operation.end(body);
	});
}

test("worker requests accept only canonical X post URLs and bounded integer budgets", () => {
	assert.deepEqual(validateSocialWorkerRequest(input), input);
	for (const change of [{ version: 2 }, { url: "http://127.0.0.1/" }, { url: "https://x.com/alice/status/123?x=1" },
		{ url: "https://instagram.com/p/123/" }, { attachmentBytes: 1 }, { attachmentBytes: SOCIAL_FILE_LIMIT + 1 },
		{ totalBytes: SOCIAL_TOTAL_LIMIT + 1 }, { totalBytes: 1024 }, { attachmentBytes: 1024.5 }]) {
		assert.throws(() => validateSocialWorkerRequest({ ...input, ...change }), /invalid_worker_request/);
	}
});

test("worker provider modes survive transport as a fixed enum, never an arbitrary URL or log string", async (context) => {
	const socket = await service(context, async () => ({ ...wire(), provider: "fxembed" }));
	assert.equal((await requestSocialWorker(socket, input)).provider, "fxembed");
	assert.equal(decodeSocialWorkerResult({ outcome: "restricted", provider: "fxembed" }, input).provider, "fxembed");
	for (const provider of ["https://evil.test?secret", ["fxembed"], {}, null]) {
		assert.deepEqual(decodeSocialWorkerResult({ ...wire(), provider }, input), { outcome: "invalid_response" });
		assert.deepEqual(decodeSocialWorkerResult({ outcome: "restricted", provider }, input), { outcome: "invalid_response" });
	}
	assert.equal(validateSocialWorkerRequest({ ...input, provider: "https://evil.test" }).provider, undefined);
});

test("sensitive worker results require an explicit request opt-in, which the runtime enables", () => {
	assert.throws(() => validateSocialWorkerRequest({ ...input, allowSensitive: "true" }), /invalid_worker_request/);
	const allowed = validateSocialWorkerRequest({ ...input, allowSensitive: true });
	assert.equal(allowed.allowSensitive, true);
	const result = wire();
	result.post.sensitive = true;
	assert.equal(decodeSocialWorkerResult(result, input).outcome, "restricted");
	assert.equal(decodeSocialWorkerResult(result, allowed).post.sensitive, true);
	result.post.sensitive = "false";
	assert.equal(decodeSocialWorkerResult(result, allowed).outcome, "invalid_response");
});

test("worker decoder accepts large attachments without recursive-regex failure and strips network URLs", () => {
	const result = decodeSocialWorkerResult(wire(SOCIAL_FILE_LIMIT), input);
	assert.equal(result.outcome, "ready");
	assert.equal(result.files[0].data.length, SOCIAL_FILE_LIMIT);
	assert.equal(result.post.media[0].imageUrl, undefined);
	assert.deepEqual(result.post.media[0].variants, []);
});

test("worker preserves safe gateway denial diagnostics without provider error text", () => {
	const value = wire();
	value.outcome = "partial";
	value.files = [];
	value.mediaFailures = ["gateway_denied"];
	assert.deepEqual(decodeSocialWorkerResult(value, input).mediaFailures, ["gateway_denied"]);
});

test("X failure diagnostics survive the Unix boundary while all provider text is stripped", async (context) => {
	const result = normalizeXPost({ tweetResult: { result: { __typename: "TweetTombstone", reason: "NsfwViewerHasNoStatedAge" } } }, "123", true);
	const socket = await service(context, async () => ({ ...result, text: "secret", files: ["secret"],
		diagnostic: { ...result.diagnostic, notice: "secret", url: "https://example.test?token=secret" } }));
	assert.deepEqual(await requestSocialWorker(socket, input), result);
	assert.deepEqual(decodeSocialWorkerResult({ outcome: "unavailable" }, input), { outcome: "unavailable" });
});

test("worker failure diagnostics reject arbitrary strings and malformed field types", () => {
	const result = normalizeXPost({ tweetResult: { result: { __typename: "TweetTombstone" } } }, "123");
	for (const diagnostic of [null, [], "secret", { ...result.diagnostic, reason: "secret" },
		{ ...result.diagnostic, hasLegacy: "false" }, { ...result.diagnostic, responseType: "secret" }]) {
		assert.deepEqual(decodeSocialWorkerResult({ ...result, diagnostic }, input), { outcome: "invalid_response" });
	}
	assert.deepEqual(decodeSocialWorkerResult({ outcome: ["restricted"], diagnostic: result.diagnostic }, input), { outcome: "invalid_response" });
});

test("worker decoder rejects malformed shapes, tampered bytes, oversized or cross-post files", () => {
	const mutations = [
		(value) => { value.version = 2; },
		(value) => { value.outcome = ["ready"]; },
		(value) => { value.post.id = "999"; },
		(value) => { value.post.url = "https://evil.test"; },
		(value) => { value.post.author.handle = "bad/handle"; },
		(value) => { value.post.text = "x".repeat(25_001); },
		(value) => { value.post.issues = ["not_an_issue"]; },
		(value) => { value.mediaFailures = ["secret provider detail"]; },
		(value) => { value.post.quote = { state: "available", post: structuredClone(value.post) }; },
		(value) => { value.files.push(value.files[0]); },
		(value) => { value.files[0].postId = "999"; },
		(value) => { value.files[0].mediaId = "999"; },
		(value) => { value.files[0].sha256 = "wrong"; },
		(value) => { value.files[0].base64 = "invalid$"; },
		(value) => { value.files[0].extension = "mp4"; },
		(value) => { value.files[0].base64 = Buffer.alloc(16).toString("base64"); value.files[0].sha256 = createHash("sha256").update(Buffer.alloc(16)).digest("hex"); },
	];
	for (const mutate of mutations) {
		const value = wire();
		mutate(value);
		assert.equal(decodeSocialWorkerResult(value, input).outcome, "invalid_response");
	}
	assert.equal(decodeSocialWorkerResult(wire(2048), { ...input, attachmentBytes: 1024 }).outcome, "invalid_response");
	assert.equal(decodeSocialWorkerResult(null, input).outcome, "invalid_response");
});

test("worker transport keeps quoted attachments distinct and enforces the combined byte budget", () => {
	const value = wire(1024);
	value.post.quote = { state: "available", post: { ...structuredClone(value.post), id: "789", url: "https://x.com/alice/status/789" } };
	value.files.push({ ...value.files[0], postId: "789" });
	assert.deepEqual(decodeSocialWorkerResult(value, input).files.map((file) => file.postId), ["123", "789"]);
	assert.equal(decodeSocialWorkerResult(value, { ...input, attachmentBytes: 1024, totalBytes: 1024 }).outcome, "invalid_response");
});

test("worker startup refuses a non-private parent directory", async () => {
	const directory = await mkdtemp("/tmp/caitlyn-wire-");
	try {
		await chmod(directory, 0o755);
		await assert.rejects(() => startSocialWorkerServer(`${directory}/worker.sock`, async () => wire()), /directory_must_be_private/);
	}
	finally { await rm(directory, { recursive: true, force: true }); }
});

test("worker Unix round trip delivers verified bytes through an owner-only socket", async (context) => {
	let calls = 0;
	const socket = await service(context, async (received) => {
		assert.deepEqual(received, input);
		calls++;
		return wire();
	});
	assert.equal((await lstat(socket)).mode & 0o777, 0o600);
	const result = await requestSocialWorker(socket, input);
	assert.equal(result.outcome, "ready");
	assert.equal(result.files[0].data.length, 16);
	assert.equal(calls, 1);
	await assert.rejects(() => startSocialWorkerServer(socket, async () => wire()), /already_exists/);
});

test("worker broker rejects malformed and oversized input before invoking extraction", async (context) => {
	let calls = 0;
	const socket = await service(context, async () => {
		calls++;
		return wire();
	});
	assert.equal(await raw(socket, "x".repeat(2049)), 413);
	assert.equal(await raw(socket, "not json"), 502);
	assert.equal(await raw(socket, JSON.stringify({ ...input, url: "https://evil.test" })), 502);
	assert.equal(await raw(socket, JSON.stringify(input), { "Content-Type": "text/plain" }), 400);
	assert.equal(calls, 0);
});

test("busy worker refuses a second job and client cancellation aborts the first", async (context) => {
	let started;
	let ended;
	const start = new Promise((resolve) => { started = resolve; });
	const end = new Promise((resolve) => { ended = resolve; });
	const socket = await service(context, async (_input, signal) => {
		started();
		await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
		ended();
		return { outcome: "timeout" };
	});
	const controller = new AbortController();
	const first = requestSocialWorker(socket, input, controller.signal);
	await start;
	assert.equal((await requestSocialWorker(socket, input)).outcome, "worker_unavailable");
	controller.abort();
	assert.equal((await first).outcome, "timeout");
	await end;
	await setImmediate();
});

test("worker socket failures, malformed output, and client deadlines become explicit outcomes", async (context) => {
	assert.equal((await requestSocialWorker("https://evil.test", input)).outcome, "worker_unavailable");
	const socket = await service(context, async () => ({ version: 1, outcome: "ready", post: {} }));
	assert.equal((await requestSocialWorker(socket, input)).outcome, "invalid_response");
	const never = await service(context, async (_input, signal) => {
		await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
		return { outcome: "timeout" };
	});
	assert.equal((await requestSocialWorker(never, input, undefined, 20)).outcome, "timeout");
});

test("worker startup refuses existing ordinary files without changing them", async () => {
	const directory = await mkdtemp("/tmp/caitlyn-wire-");
	const file = `${directory}/owner.txt`;
	try {
		await writeFile(file, "owned fixture", { mode: 0o600 });
		await assert.rejects(() => startSocialWorkerServer(file, async () => wire()), /already_exists/);
		assert.ok((await lstat(file)).isFile());
	}
	finally { await rm(directory, { recursive: true, force: true }); }
});
