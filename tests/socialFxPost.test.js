/**
 * @file socialFxPost.test.js
 * @description Exercises FxEmbed normalization, ordered media, quotes, and conservative source preservation.
 * Uses synthetic public metadata without network requests or Discord actions.
 *
 * @module socialFxPost.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFxPost } from "../core/socialFxPost.ts";
import { decodeSocialMetadataResult } from "../core/socialWorkerClient.ts";

const status = (changes = {}) => ({ type: "status", provider: "twitter", id: "123", text: "A post",
	author: { name: "Alice", screen_name: "alice", protected: false }, media: {}, possibly_sensitive: false, ...changes });
const photo = (changes = {}) => ({ type: "photo", url: "https://pbs.twimg.com/media/one.jpg", width: 640, height: 360, ...changes });
const video = (changes = {}) => ({ type: "video", id: "456", url: "https://video.twimg.com/clip.mp4", duration: 10,
	formats: [{ container: "mp4", codec: "h264", url: "https://video.twimg.com/clip.mp4", bitrate: 800000 }], ...changes });
const normalize = (changes = {}, allowSensitive = false) => normalizeFxPost({ code: 200, status: status(changes) }, "123", allowSensitive);

test("FxEmbed text is fully attributed, bounded, and not interpreted as a restriction", () => {
	const result = normalize({ text: "This post is age-restricted @everyone <script>!" });
	assert.equal(result.outcome, "ready");
	assert.equal(result.post.author.handle, "alice");
	assert.equal(result.post.url, "https://x.com/alice/status/123");
	assert.equal(normalize({ id: "999" }).outcome, "invalid_response");
	assert.equal(normalize({ provider: "instagram" }).outcome, "invalid_response");
	assert.equal(normalize({ author: { name: "Alice", screen_name: "../bob" } }).outcome, "invalid_response");
	assert.equal(normalizeFxPost({ code: 200, status: status() }, "0").outcome, "invalid_response");
});

test("FxEmbed ordered photos and MP4 variants survive the metadata wire boundary", () => {
	const result = normalize({ media: { all: [photo(), video(), photo({ url: "https://pbs.twimg.com/media/two.png" })] } });
	assert.equal(result.outcome, "ready");
	assert.deepEqual(result.post.media.map((item) => item.kind), ["image", "video", "image"]);
	assert.equal(result.post.media[0].imageUrl, "https://pbs.twimg.com/media/one.jpg?name=orig");
	assert.equal(result.post.media[1].durationSeconds, 10);
	const wire = decodeSocialMetadataResult({ ...result, version: 1, purpose: "metadata", provider: "fxembed" }, { version: 1, url: result.post.url });
	assert.equal(wire.outcome, "ready");
	assert.equal(wire.post.media.length, 3);
	assert.equal(normalize({ media: { all: [photo()] } }).post.media[0].id, result.post.media[0].id);
});

test("FxEmbed keeps only bounded CDN MP4s and never accepts redirects, HTML or provider proxy URLs", () => {
	for (const url of ["http://127.0.0.1/clip.mp4", "https://evil.test/clip.mp4", "https://api.fxtwitter.com/2/go?url=clip", "https://video.twimg.com/a/../clip.mp4"]) {
		const result = normalize({ media: { all: [video({ url, formats: [] })] } });
		assert.equal(result.outcome, "partial");
		assert.equal(result.post.media.length, 0);
	}
	const result = normalize({ media: { all: [video({ formats: [
		{ container: "m3u8", url: "https://video.twimg.com/hls.m3u8" },
		{ container: "mp4", codec: "hevc", url: "https://video.twimg.com/hevc.mp4" },
		{ container: "mp4", codec: "h264", url: "https://video.twimg.com/clip.mp4", bitrate: 1000 },
	] })] } });
	assert.equal(result.post.media[0].variants.length, 1);
});

test("FxEmbed missing ordered media, unsupported cards, overflow and duplicate IDs remain incomplete", () => {
	for (const changes of [{ media: { photos: [photo()] } }, { poll: {} }, { article: {} }, { card: {} },
		{ media: { external: {} } }, { text: "x".repeat(25001) }, { media: { all: Array.from({ length: 5 }, () => photo()) } }]) {
		assert.equal(normalize(changes).outcome, "partial");
	}
	assert.equal(normalize({ media: { all: [photo({ id: "456" }), video()] } }).outcome, "invalid_response");
	assert.equal(normalize({ media: [] }).outcome, "invalid_response");
});

test("FxEmbed quote media is independently attributed and nested quotes cannot authorize complete replacement", () => {
	const quote = status({ id: "789", author: { name: "Bob", screen_name: "bob" }, media: { all: [video()] } });
	const result = normalize({ quote, media: { all: [photo()] } });
	assert.equal(result.outcome, "ready");
	assert.equal(result.post.quote.post.author.handle, "bob");
	assert.equal(result.post.quote.post.id, "789");
	assert.equal(normalize({ quote: { ...quote, quote: status({ id: "999" }) } }).outcome, "partial");
	assert.equal(normalize({ quote: status() }).outcome, "partial");
	assert.equal(normalize({ quote: { type: "tombstone", provider: "twitter", id: "789", reason: "deleted" } }).outcome, "partial");
});

test("FxEmbed sensitivity opt-in cannot override protected posts or denied quote access", () => {
	assert.equal(normalize({ possibly_sensitive: true }).outcome, "restricted");
	assert.equal(normalize({ possibly_sensitive: true }, true).outcome, "ready");
	assert.equal(normalize({ author: { name: "Alice", screen_name: "alice", protected: true } }, true).outcome, "restricted");
	assert.equal(normalize({ quote: status({ id: "789", possibly_sensitive: true }) }).outcome, "restricted");
	assert.equal(normalize({ quote: { type: "tombstone", provider: "twitter", id: "789", reason: "private" } }, true).outcome, "restricted");
});

test("FxEmbed API failures and tombstones produce closed outcomes without exposing provider messages", () => {
	for (const [code, outcome] of [[401, "restricted"], [403, "restricted"], [404, "unavailable"], [429, "rate_limited"],
		[500, "worker_unavailable"], [302, "invalid_response"], ["200", "invalid_response"]]) {
		const result = normalizeFxPost({ code, message: "secret", status: status() }, "123", true);
		assert.equal(result.outcome, outcome);
		assert.ok(!JSON.stringify(result).includes("secret"));
		assert.equal(result.post, undefined);
	}
	const result = normalize({ type: "tombstone", reason: "deleted", message: "secret" });
	assert.equal(result.outcome, "unavailable");
	assert.ok(!JSON.stringify(result).includes("secret"));
});
