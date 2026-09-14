/**
 * @file socialXDelivery.test.js
 * @description Verifies shared compression for X parent/quoted videos, aggregate limits and safe failures.
 * Uses injected local tools and synthetic metadata/bytes; never downloads or sends Discord messages.
 *
 * @module socialXDelivery.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverXPost } from "../scripts/mediaSandbox/xPostWorker.ts";
import { normalizeFxPost } from "../core/socialFxPost.ts";
import { xVideoCandidates } from "../core/socialXPost.ts";
import { decodeSocialWorkerResult } from "../core/socialWorkerClient.ts";
import { renderSocialPost } from "../core/socialPostRender.ts";

const url = "https://x.com/alice/status/123";
const attachmentBytes = 128 * 1024;
const sourceCap = 48 * 1024 * 1024;
// The worker budget is for media; these renderer checks also allow its existing 128 KiB payload reserve.
const renderLimits = (totalBytes = attachmentBytes * 2) => ({ attachmentBytes, messageBytes: totalBytes + 128 * 1024 });
const status = (id = "123", handle = "alice", media = []) => ({ type: "status", provider: "twitter", id, text: `Caption ${handle}`,
	author: { name: handle, screen_name: handle, protected: false }, media: { all: media } });
const video = (id = "456", changes = {}) => ({ type: "video", id, duration: 10, url: `https://video.twimg.com/${id}.mp4`,
	formats: [{ container: "mp4", codec: "h264", url: `https://video.twimg.com/${id}.mp4`, bitrate: 800_000 }], ...changes });
function mp4(size) {
	const data = Buffer.alloc(size);
	data.write("ftypisom", 4, "ascii");
	return data;
}
function dependencies(sourceBytes = 700_000) {
	const calls = [];
	let data;
	return { calls, normalize: normalizeFxPost, candidates: xVideoCandidates,
		retrieve: async (kind, candidate, limit) => {
			calls.push(["download", kind, candidate, limit]);
			if (sourceBytes > limit) throw new Error("size_limit");
			data = mp4(sourceBytes);
			return { bytes: data.length };
		},
		execute: async (command) => ({ stdout: command === "ffprobe" ? JSON.stringify({ streams: [
			{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }, { codec_type: "audio", codec_name: "aac" },
		], format: { duration: "10" } }) : "" }),
		compress: async (limit) => {
			calls.push(["compress", limit]);
			data = mp4(limit - 16);
			return { outcome: "video_verified", bytes: data.length, compressed: true };
		},
		readFile: async (path) => {
			assert.equal(path, "/tmp/x-video.mp4");
			return data;
		} };
}
async function deliver(raw, fake = dependencies(), totalBytes = attachmentBytes * 2) {
	const wire = await deliverXPost(url, attachmentBytes, totalBytes, false, { code: 200, status: raw }, fake);
	const result = decodeSocialWorkerResult(wire, { version: 1, url, attachmentBytes, totalBytes });
	return { wire, result, fake };
}

test("X parent and quote videos compress independently against the remaining message budget", async () => {
	const raw = { ...status("123", "alice", [video()]), quote: status("789", "bob", [video()]) };
	const totalBytes = attachmentBytes + 120 * 1024;
	const { result, fake } = await deliver(raw, dependencies(), totalBytes);
	assert.equal(result.outcome, "ready");
	assert.deepEqual(result.files.map((file) => [file.postId, file.mediaId, file.compressed]), [["123", "456", true], ["789", "456", true]]);
	assert.deepEqual(fake.calls.filter(([kind]) => kind === "compress"), [["compress", attachmentBytes], ["compress", 120 * 1024 + 16]]);
	assert.equal(result.files.reduce((sum, file) => sum + file.data.length, 0), totalBytes - 16);
	const rendered = renderSocialPost(result.post, result.files, renderLimits(totalBytes), "111");
	assert.equal(rendered.complete, true);
	assert.equal(rendered.omittedMedia, 0);
	assert.deepEqual(rendered.payload.files.map((file) => file.name), ["x-post-video-1.mp4", "x-quote-video-1.mp4"]);
	for (const embed of rendered.payload.embeds) assert.match(embed.description, /Video compressed to fit the upload limit; quality is reduced/);
	assert.match(rendered.payload.embeds[0].author.name, /alice/);
	assert.match(rendered.payload.embeds[1].author.name, /bob/);
});

test("X fitting originals are unchanged and only the affected quote receives a compression notice", async () => {
	const raw = { ...status("123", "alice", [video()]), quote: status("789", "bob", [video("457")]) };
	const fake = dependencies();
	const retrieve = fake.retrieve;
	const readFile = fake.readFile;
	let original = false;
	fake.retrieve = async (kind, candidate, limit) => {
		original = candidate.endsWith("456.mp4");
		return original ? { bytes: 100 } : retrieve(kind, candidate, limit);
	};
	fake.readFile = async (path) => original ? mp4(100) : readFile(path);
	const { result } = await deliver(raw, fake);
	assert.equal(result.outcome, "ready");
	assert.equal(result.files[0].compressed, undefined);
	assert.equal(result.files[1].compressed, true);
	const rendered = renderSocialPost(result.post, result.files, renderLimits());
	assert.doesNotMatch(rendered.payload.embeds[0].description, /compressed/);
	assert.match(rendered.payload.embeds[1].description, /compressed/);
});

test("multiple compressed X videos preserve media order and add one quality notice per card", async () => {
	const { result } = await deliver(status("123", "alice", [video("456"), video("457")]), dependencies(), attachmentBytes * 3);
	assert.equal(result.outcome, "ready");
	assert.deepEqual(result.files.map((file) => file.mediaId), ["456", "457"]);
	const rendered = renderSocialPost(result.post, result.files, renderLimits(attachmentBytes * 3));
	assert.equal(rendered.complete, true);
	assert.deepEqual(rendered.payload.files.map((file) => file.name), ["x-post-video-1.mp4", "x-post-video-2.mp4"]);
	assert.equal(rendered.payload.embeds[0].description.match(/Video compressed/g).length, 1);
});

test("X compression failures remain partial and actual access denial halts quote downloads", async () => {
	const raw = { ...status("123", "alice", [video()]), quote: status("789", "bob", [video("457")]) };
	for (const outcome of ["size_limit", "compression_timeout", "compression_incomplete", "video_validation_failed"]) {
		const fake = dependencies();
		fake.compress = async () => ({ outcome });
		const { result } = await deliver(raw, fake);
		assert.equal(result.outcome, "partial");
		assert.deepEqual(result.mediaFailures, [outcome, outcome]);
		assert.equal(result.files.length, 0);
		assert.equal(renderSocialPost(result.post, result.files, renderLimits()).complete, false);
	}
	for (const outcome of ["rate_limited", "access_denied", "gateway_denied", "login_or_restriction"]) {
		const fake = dependencies();
		fake.retrieve = async () => {
			fake.calls.push(["denied"]);
			throw new Error(outcome);
		};
		const { result } = await deliver(raw, fake);
		assert.equal(result.outcome, "partial");
		assert.deepEqual(result.mediaFailures, [outcome, "not_attempted"]);
		assert.deepEqual(fake.calls, [["denied"]]);
	}
});

test("X fallback retains four downloads, chooses the smallest eligible source and caps source size", async () => {
	const fake = dependencies();
	fake.candidates = (_media, _limit, smallest) => Array.from({ length: 6 }, (_, i) => ({ url: `https://video.twimg.com/${smallest ? "source" : i}.mp4` }));
	await deliver(status("123", "alice", [video()]), fake);
	assert.deepEqual(fake.calls.filter(([kind]) => kind === "download").map((call) => call[3]), [attachmentBytes, attachmentBytes, attachmentBytes, sourceCap]);
	const media = { kind: "video", durationSeconds: 10, variants: [
		{ url: "large", bitrate: 90_000_000 }, { url: "unknown", bitrate: 0 }, { url: "medium", bitrate: 800_000, height: 720 }, { url: "small", bitrate: 400_000, height: 360 },
	] };
	assert.deepEqual(xVideoCandidates(media, sourceCap, true).map((v) => v.url), ["small", "medium", "unknown"]);
	assert.equal(media.variants[0].url, "large");
	const capped = dependencies();
	const { result } = await deliver(status("123", "alice", [video("456", { formats: [{ url: "https://video.twimg.com/456.mp4", bitrate: 90_000_000 }] })]), capped);
	assert.equal(result.outcome, "partial");
	assert.equal(capped.calls.filter(([kind]) => kind === "download").length, 1);
	assert.equal(capped.calls.some(([kind]) => kind === "compress"), false);
});

test("X silent GIFs stay original-only and exhausted quote budgets cannot bypass quality limits", async () => {
	const gif = dependencies();
	const first = await deliver(status("123", "alice", [video("456", { type: "gif" })]), gif);
	assert.equal(first.result.outcome, "partial");
	assert.ok(!gif.calls.some(([kind]) => kind === "compress"));
	const raw = { ...status("123", "alice", [video()]), quote: status("789", "bob", [video("457")]) };
	const { result, fake } = await deliver(raw, dependencies(), attachmentBytes);
	assert.equal(result.outcome, "partial");
	assert.deepEqual(result.mediaFailures, ["size_limit"]);
	assert.equal(result.files.length, 1);
	assert.equal(fake.calls.filter(([kind]) => kind === "compress").length, 1);
	assert.equal(renderSocialPost(result.post, result.files, renderLimits()).complete, false);
});

test("X compressed wire fields require video identity, valid booleans and verified byte counts", async () => {
	const raw = status("123", "alice", [video()]);
	const { wire } = await deliver(raw);
	for (const marker of [1, "true", null, {}]) {
		const changed = structuredClone(wire);
		changed.files[0].compressed = marker;
		assert.equal(decodeSocialWorkerResult(changed, { version: 1, url, attachmentBytes, totalBytes: attachmentBytes * 2 }).outcome, "invalid_response");
	}
	const gif = structuredClone(wire);
	gif.post.media[0].kind = "gif";
	assert.equal(decodeSocialWorkerResult(gif, { version: 1, url, attachmentBytes, totalBytes: attachmentBytes * 2 }).outcome, "invalid_response");
	for (const size of [0, 50, attachmentBytes + 1]) {
		const fake = dependencies();
		fake.readFile = async () => size ? mp4(size) : Buffer.alloc(0);
		const { result } = await deliver(raw, fake);
		assert.notEqual(result.outcome, "ready");
	}
});
