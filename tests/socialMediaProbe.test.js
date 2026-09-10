/**
 * @file socialMediaProbe.test.js
 * @description Tests metadata-probe deadlines, response bounds, redaction, and access gates.
 * All provider requests use injected responses; no live network or Discord connection is made.
 *
 * @module socialMediaProbe.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { probeSocialMedia, runSocialProbes } from "../scripts/probeSocialMedia.ts";
import { subscribeLogs } from "../core/logger.ts";

const postUrl = "https://x.com/alice/status/123";
const payload = { type: "rich", html: "<script>must-not-run()</script>", author_name: "Alice" };

test("probes only fixed official endpoints with credential-free canonical URL parameters", async () => {
	for (const [input, destination] of [
		[`${postUrl}/video/1?token=secret`, "https://publish.x.com/oembed"],
		["https://instagram.com/reel/ABC/?igsh=secret", "https://graph.facebook.com/v25.0/instagram_oembed"],
		["https://tiktok.com/@alice/video/123?tracking=secret", "https://www.tiktok.com/oembed"],
	]) {
		const result = await probeSocialMedia(input, { fetch: async (url, options) => {
			assert.equal(`${url.origin}${url.pathname}`, destination);
			assert.ok(!url.href.includes("secret"));
			assert.equal(options.redirect, "manual");
			assert.equal(options.credentials, "omit");
			assert.equal(options.headers.Authorization, undefined);
			assert.equal(options.headers.Cookie, undefined);
			assert.ok(options.signal instanceof AbortSignal);
			return Response.json(payload);
		} });
		assert.equal(result.outcome, "metadata");
		assert.equal(result.mediaDownloadTested, false);
		assert.deepEqual(result.fields, { author: true, title: false, html: true, thumbnail: false });
		assert.ok(!JSON.stringify(result).includes("must-not-run"));
	}
});

test("invalid URLs, unresolved shares, and unapproved Reddit access make no request", async () => {
	for (const [url, outcome] of [
		["https://localhost/", "invalid_link"],
		["https://vm.tiktok.com/ABC/", "needs_resolution"],
		["https://reddit.com/r/test/comments/abc/title/", "approval_required"],
	]) {
		const result = await probeSocialMedia(url, { fetch: async () => { throw new Error("Network must not be called"); } });
		assert.equal(result.outcome, outcome);
	}
});

test("HTTP failures and redirects remain failures without following Location or exposing bodies", async () => {
	for (const status of [301, 302, 401, 403, 404, 429, 500, 503]) {
		let requests = 0;
		const result = await probeSocialMedia(postUrl, { fetch: async () => {
			requests++;
			return new Response("secret error body", { status, headers: { Location: "http://100.70.173.118/private", "Retry-After": "3600" } });
		} });
		assert.equal(requests, 1);
		assert.equal(result.outcome, "http_error");
		assert.equal(result.status, status);
		assert.ok(!JSON.stringify(result).includes("secret"));
	}
});

test("invalid, HTML, empty, and API-error responses cannot masquerade as metadata", async () => {
	for (const response of [
		new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
		new Response("broken JSON", { headers: { "Content-Type": "application/json" } }),
		new Response(null, { status: 204 }),
		Response.json(null), Response.json([]), Response.json({}),
		Response.json({ ...payload, error: { message: "secret" } }),
		Response.json({ type: "video", html: " " }),
	]) {
		const result = await probeSocialMedia(postUrl, { fetch: async () => response });
		assert.equal(result.outcome, "invalid_response");
	}
});

test("bounds advertised and streamed response size independently", async () => {
	const advertised = await probeSocialMedia(postUrl, { fetch: async () => new Response("{}", {
		headers: { "Content-Type": "application/json", "Content-Length": "262145" },
	}) });
	assert.equal(advertised.outcome, "response_too_large");
	let cancelled = false;
	const oversized = new ReadableStream({
		start(controller) { controller.enqueue(new Uint8Array(262_145)); },
		cancel() { cancelled = true; },
	});
	const streamed = await probeSocialMedia(postUrl, { fetch: async () => new Response(oversized, {
		headers: { "Content-Type": "application/json", "Content-Length": "1" },
	}) });
	assert.equal(streamed.outcome, "response_too_large");
	assert.equal(cancelled, true);
});

test("aborts a stalled request and does not expose network-error details", async () => {
	let aborted = false;
	const timeout = await probeSocialMedia(postUrl, {
		timeoutMs: 10,
		fetch: async (_, { signal }) => new Promise((resolve, reject) => {
			signal.addEventListener("abort", () => {
				aborted = true;
				reject(new Error("secret"));
			}, { once: true });
		}),
	});
	assert.equal(aborted, true);
	assert.equal(timeout.outcome, "timeout");
	const failure = await probeSocialMedia(postUrl, { fetch: async () => { throw new Error("secret token in request URL"); } });
	assert.equal(failure.outcome, "network_error");
	assert.ok(!JSON.stringify(failure).includes("secret"));
});

test("the request deadline also aborts a stalled response body", async () => {
	const result = await probeSocialMedia(postUrl, {
		timeoutMs: 10,
		fetch: async (_, { signal }) => new Response(new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("{"));
				signal.addEventListener("abort", () => { controller.error(new Error("aborted")); }, { once: true });
			},
		}), { headers: { "Content-Type": "application/json" } }),
	});
	assert.equal(result.outcome, "timeout");
});

test("rejects invalid deadlines before calling a provider", async () => {
	for (const timeoutMs of [0, -1, Infinity, NaN, 1.5, 20_001]) {
		await assert.rejects(probeSocialMedia(postUrl, { timeoutMs }), RangeError);
	}
});

test("the CLI bounds work, deduplicates posts, and emits safe categories through existing logging", async () => {
	const logs = [];
	const unsubscribe = subscribeLogs((record) => logs.push(record));
	try {
		assert.equal(await runSocialProbes([]), 2);
		assert.equal(await runSocialProbes(Array(11).fill(postUrl)), 2);
		logs.length = 0;
		assert.equal(await runSocialProbes([
			"https://reddit.com/r/test/comments/abc/title/?token=secret",
			"https://redd.it/abc",
			"http://user:secret@localhost/",
		]), 1);
		assert.equal(logs.length, 2);
		assert.ok(logs.every((record) => record.level === "WARN"));
		assert.ok(!JSON.stringify(logs).includes("secret"));
		assert.match(logs[0].message, /approval_required/);
	}
	finally {
		unsubscribe();
	}
});
