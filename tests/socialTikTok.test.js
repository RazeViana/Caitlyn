/**
 * @file socialTikTok.test.js
 * @description Tests TikTok normalization, isolated video verification, transport, and durable alias safety.
 * Uses synthetic metadata/bytes and injected services; no live providers or Discord operations.
 *
 * @module socialTikTok.test
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import { normalizeTikTokPost, tikTokMediaUrl, tikTokVideoCandidates } from "../core/socialTikTokPost.ts";
import { deliverTikTokPost } from "../scripts/mediaSandbox/tikTokPostWorker.ts";
import { decodeSocialWorkerResult, requestSocialWorker, validateSocialWorkerRequest, validateSocialMetadataRequest } from "../core/socialWorkerClient.ts";
import { extractSocialLinks, socialJobPostId, socialPostCaption, supportedSocialLink } from "../core/socialLinks.ts";
import { renderSocialPost } from "../core/socialPostRender.ts";
import { startSocialWorkerServer } from "../scripts/socialWorker/server.ts";
import { createSocialDeliveryStore } from "../core/socialDeliveryStore.ts";
import { allowedTunnel } from "../scripts/mediaSandbox/gateway.ts";

const url = "https://www.tiktok.com/@test.creator/video/123";
const cdn = "https://v16.tiktokcdn.com/video/clip.mp4?signature=fixture";
const input = { version: 1, url, attachmentBytes: 1024, totalBytes: 2048 };
const bytes = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisom"), Buffer.alloc(16)]);

function raw() {
	return { extractor_key: "TikTok", id: "123", uploader: "test.creator", channel: "Creator", description: "Caption @everyone", duration: 10,
		formats: [{ url: cdn, ext: "mp4", protocol: "https", vcodec: "h264", acodec: "aac", tbr: 100, filesize: 1000, width: 640, height: 360 }] };
}

function dependencies(metadata = raw()) {
	const calls = [];
	return { calls, normalize: normalizeTikTokPost, candidates: tikTokVideoCandidates,
		retrieve: async (kind, candidate, limit) => {
			calls.push([kind, candidate, limit]);
			return kind === "metadata" ? metadata : { bytes: bytes.length, mime: "video/mp4" };
		},
		execute: async (command, args) => {
			calls.push([command, args]);
			assert.ok(args.includes("file,pipe"));
			return { stdout: command === "ffprobe" ? JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "10" } }) : "" };
		},
		readFile: async (path) => {
			assert.equal(path, "/tmp/x-video.mp4");
			return bytes;
		} };
}

test("TikTok metadata keeps full captions/author identity and selects only muxed MP4 candidates", () => {
	const value = raw();
	value.formats.push(...["none", "hevc", "bytevc2"].map((vcodec) => ({ ...value.formats[0], vcodec })));
	const result = normalizeTikTokPost(value, "123");
	assert.equal(result.outcome, "ready");
	assert.equal(result.post.platform, "tiktok");
	assert.equal(result.post.url, url);
	assert.equal(result.post.author.handle, "test.creator");
	assert.equal(result.post.text, value.description);
	assert.equal(result.post.media[0].variants.length, 1);
	assert.equal(normalizeTikTokPost(value, "456").outcome, "invalid_response");
});

test("TikTok refuses slideshows, playlists, private/live posts and malicious response shapes", () => {
	for (const changes of [{ formats: [] }, { formats: [{ ...raw().formats[0], vcodec: "none" }] }]) {
		assert.equal(normalizeTikTokPost({ ...raw(), ...changes }).outcome, "unsupported");
	}
	for (const changes of [{ availability: "private" }, { age_limit: 18 }, { is_live: true }]) {
		assert.equal(normalizeTikTokPost({ ...raw(), ...changes }).outcome, "restricted");
	}
	for (const changes of [{ entries: [] }, { _type: "playlist" }, { extractor_key: "Generic" }, { id: 123 }, { uploader: "../../secret" }, { formats: Array(129).fill({}) }]) {
		assert.equal(normalizeTikTokPost({ ...raw(), ...changes }).outcome, "invalid_response");
	}
	const partial = normalizeTikTokPost({ ...raw(), description: "x".repeat(25_001) });
	assert.equal(partial.outcome, "partial");
	assert.equal(partial.post.text.length, 25_000);
	assert.equal(normalizeTikTokPost({ ...raw(), description: undefined }).post.textComplete, false);
	assert.equal(normalizeTikTokPost({ ...raw(), description: `${"x".repeat(24_999)}😀` }).post.text.length, 24_999);
});

test("TikTok CDN validation rejects private/ambiguous hosts, credentials, traversal, and arbitrary protocols", () => {
	assert.equal(tikTokMediaUrl(cdn), cdn);
	assert.equal(tikTokMediaUrl("https://v16-webapp-prime.tiktok.com/video/fixture"), "https://v16-webapp-prime.tiktok.com/video/fixture");
	assert.equal(tikTokMediaUrl("https://www.tiktok.com/private"), undefined);
	for (const value of ["http://v16.tiktokcdn.com/a", "https://127.0.0.1/a", "https://100.70.173.118/a", "https://tiktokcdn.com.evil.test/a",
		"https://user:secret@v16.tiktokcdn.com/a", "https://v16.tiktokcdn.com:443/a", "https://v16.tiktokcdn.com/../a",
		"https://v16.tiktokcdn.com/%2e%2e/a", "https://v16.tiktokcdn.com/a#fragment", "https://evil.test/a", "file:///a"]) assert.equal(tikTokMediaUrl(value), undefined);
});

test("production gateways isolate TikTok and X destinations from each other and other platforms", () => {
	assert.equal(allowedTunnel("v16-webapp-prime.tiktok.com:443", "tiktok"), "v16-webapp-prime.tiktok.com");
	assert.equal(allowedTunnel("video.twimg.com:443", "tiktok"), null);
	assert.equal(allowedTunnel("v16.tiktokcdn.com:443", "x"), null);
	assert.equal(allowedTunnel("www.instagram.com:443", "tiktok"), null);
	assert.equal(allowedTunnel("www.tiktok.com:80", "tiktok"), null);
});

test("TikTok budgets reject known oversized variants and keep bounded descending quality", () => {
	const media = normalizeTikTokPost(raw()).post.media[0];
	media.variants = [{ url: cdn, bitrate: 1000, estimatedBytes: 2000 }, { url: cdn, bitrate: 500, estimatedBytes: 900 }, { url: cdn, bitrate: 100, estimatedBytes: 100 }];
	assert.deepEqual(tikTokVideoCandidates(media, 1024).map((variant) => variant.bitrate), [500, 100]);
	assert.equal(tikTokVideoCandidates(media, 99).length, 0);
});

test("TikTok worker verifies audio/video/decode and transports bytes rather than CDN links", async () => {
	const fake = dependencies();
	const wire = { ...await deliverTikTokPost(url, 1024, 2048, fake), provider: "tiktok" };
	const result = decodeSocialWorkerResult(wire, input);
	assert.equal(result.outcome, "ready");
	assert.deepEqual(result.files[0].data, bytes);
	assert.equal(result.post.media[0].variants.length, 0);
	assert.ok(!JSON.stringify(result).includes("signature"));
	assert.equal(fake.calls.filter(([name]) => name === "ffmpeg").length, 1);
	const rendered = renderSocialPost(result.post, result.files, { attachmentBytes: 1024, messageBytes: 1024 * 1024 });
	assert.equal(rendered.payload.embeds[0].title, undefined);
	assert.equal(rendered.payload.embeds[0].description, `Caption @\u200Beveryone\n\nTikTok · Video · [Original ↗](${url})`);
	assert.equal(rendered.payload.embeds[0].url, url);
	assert.equal(rendered.payload.files[0].name, "tiktok-post-video-1.mp4");
	assert.ok(!rendered.payload.embeds[0].description.includes("@everyone"));
	assert.equal(rendered.complete, true);
});

test("TikTok restriction failures never retry alternate URLs or leak provider diagnostics", async () => {
	for (const outcome of ["restricted", "rate_limited", "unavailable", "access_denied", "timeout", "unsupported", "secret https://evil.test"]) {
		const fake = dependencies();
		fake.retrieve = async () => { throw new Error(outcome); };
		const result = await deliverTikTokPost(url, 1024, 2048, fake);
		assert.ok(!("post" in result));
		assert.ok(!JSON.stringify(result).includes("secret"));
		assert.equal(fake.calls.length, 0);
	}
	const fake = dependencies();
	fake.retrieve = async (kind) => {
		fake.calls.push(kind);
		if (kind === "metadata") return raw();
		throw new Error("access_denied");
	};
	const result = await deliverTikTokPost(url, 1024, 2048, fake);
	assert.equal(result.outcome, "partial");
	assert.deepEqual(result.mediaFailures, ["access_denied"]);
	assert.deepEqual(result.files, []);
	assert.deepEqual(fake.calls, ["metadata", "video"]);
});

test("TikTok oversized videos produce explicitly partial previews and never authorize source deletion", async () => {
	const value = raw();
	value.formats[0].filesize = 40 * 1024 * 1024;
	const fake = dependencies(value);
	const result = await deliverTikTokPost(url, 1024, 2048, fake);
	assert.equal(result.outcome, "partial");
	assert.deepEqual(result.mediaFailures, ["size_limit"]);
	assert.equal(fake.calls.length, 1);
	assert.equal(renderSocialPost(result.post, [], { attachmentBytes: 1024, messageBytes: 1024 * 1024 }).complete, false);
});

test("TikTok compresses one bounded larger source, preserves the upload cap and labels reduced quality", async () => {
	const value = raw();
	value.formats[0].filesize = 700_000;
	const f = dependencies(value);
	const retrieve = f.retrieve;
	f.retrieve = async (...args) => args[0] === "metadata" ? retrieve(...args) : (f.calls.push(args), { bytes: 700_000 });
	f.compress = async (limit) => {
		f.calls.push(["compress", limit]);
		return { outcome: "video_verified", bytes: bytes.length, compressed: true };
	};
	const wire = { ...await deliverTikTokPost(url, 128 * 1024, 256 * 1024, f), provider: "tiktok" };
	assert.equal(wire.outcome, "ready");
	assert.deepEqual(f.calls.filter(([kind]) => kind === "video").map((call) => call[2]), [48 * 1024 * 1024]);
	assert.deepEqual(f.calls.find(([kind]) => kind === "compress"), ["compress", 128 * 1024]);
	const result = decodeSocialWorkerResult(wire, { ...input, attachmentBytes: 128 * 1024, totalBytes: 256 * 1024 });
	assert.equal(result.outcome, "ready");
	assert.equal(result.files[0].compressed, true);
	const rendered = renderSocialPost(result.post, result.files, { attachmentBytes: 128 * 1024, messageBytes: 256 * 1024 });
	assert.equal(rendered.complete, true);
	assert.ok(rendered.payload.embeds[0].description.includes("Video compressed to fit the upload limit; quality is reduced."));
	for (const marker of ["yes", 1, {}, null]) {
		const changed = structuredClone(wire);
		changed.files[0].compressed = marker;
		assert.equal(decodeSocialWorkerResult(changed, { ...input, attachmentBytes: 128 * 1024, totalBytes: 256 * 1024 }).outcome, "invalid_response");
	}
});

test("TikTok compression never retries access failures or promotes incomplete output to a replacement", async () => {
	for (const reason of ["access_denied", "rate_limited", "timeout", "video_validation_failed", "size_limit", "compression_timeout", "compression_incomplete"]) {
		const value = raw();
		value.formats[0].filesize = 700_000;
		const f = dependencies(value);
		const retrieve = f.retrieve;
		f.retrieve = async (...args) => {
			if (args[0] === "metadata") return retrieve(...args);
			f.calls.push(args);
			if (["access_denied", "rate_limited", "timeout"].includes(reason)) throw new Error(reason);
			return { bytes: 700_000 };
		};
		f.compress = async () => {
			f.calls.push(["compress"]);
			return { outcome: reason };
		};
		const wire = await deliverTikTokPost(url, 128 * 1024, 256 * 1024, f);
		assert.equal(wire.outcome, "partial");
		assert.deepEqual(wire.files, []);
		assert.deepEqual(wire.mediaFailures, [reason]);
		assert.equal(f.calls.filter(([kind]) => kind === "video").length, 1);
		assert.equal(f.calls.filter(([kind]) => kind === "compress").length, ["access_denied", "rate_limited", "timeout"].includes(reason) ? 0 : 1);
	}
});

test("TikTok compression preserves the four-download bound and skips sources over its temporary cap", async () => {
	const value = raw();
	value.formats = Array.from({ length: 8 }, (_, index) => ({ ...value.formats[0], url: `${cdn}&variant=${index}`, filesize: 1000 }));
	const f = dependencies(value);
	const retrieve = f.retrieve;
	f.retrieve = async (...args) => {
		if (args[0] === "metadata") return retrieve(...args);
		f.calls.push(args);
		throw new Error("size_limit");
	};
	const wire = await deliverTikTokPost(url, 128 * 1024, 256 * 1024, f);
	assert.equal(wire.outcome, "partial");
	assert.equal(f.calls.filter(([kind]) => kind === "video").length, 4);
	assert.deepEqual(f.calls.filter(([kind]) => kind === "video").map((call) => call[2]), [128 * 1024, 128 * 1024, 128 * 1024, 48 * 1024 * 1024]);
	value.formats.forEach((format) => { format.filesize = 48 * 1024 * 1024 + 1; });
	const oversized = dependencies(value);
	assert.equal((await deliverTikTokPost(url, 128 * 1024, 256 * 1024, oversized)).outcome, "partial");
	assert.equal(oversized.calls.length, 1);
});

test("TikTok wire validation binds platform/post/author/media identities and enforces response integrity", async () => {
	const wire = { ...await deliverTikTokPost(url, 1024, 2048, dependencies()), provider: "tiktok" };
	for (const mutate of [
		(value) => { value.provider = "fxembed"; }, (value) => { delete value.provider; },
		(value) => { value.post.platform = "x"; }, (value) => { value.post.id = "999"; },
		(value) => { value.post.url = "https://evil.test"; }, (value) => { value.post.author.handle = "bad/name"; },
		(value) => { value.post.media[0].kind = "image"; }, (value) => { value.post.media = []; },
		(value) => { value.post.quote = { state: "unavailable" }; }, (value) => { value.post.sensitive = true; },
		(value) => { value.files[0].sha256 = "wrong"; }, (value) => { value.files[0].postId = "999"; },
	]) {
		const changed = structuredClone(wire);
		mutate(changed);
		assert.equal(decodeSocialWorkerResult(changed, input).outcome, "invalid_response");
	}
	assert.equal(decodeSocialWorkerResult(wire, { ...input, url: "https://x.com/alice/status/123" }).outcome, "invalid_response");
	assert.equal(decodeSocialWorkerResult(wire, { ...input, url: "https://vm.tiktok.com/Example/" }).outcome, "ready");
});

test("TikTok links use collision-free queue identities and keep unsupported/hidden links in captions", () => {
	const content = `Caption https://x.com/alice/status/123 ${url}?tracking=1 https://vm.tiktok.com/Example/ https://www.tiktok.com/@test/photo/456 ||${url}||`;
	const links = extractSocialLinks(content).filter(supportedSocialLink);
	assert.equal(links.length, 3);
	assert.deepEqual(links.slice(0, 2).map(socialJobPostId), ["123", "tiktok:123"]);
	assert.match(socialJobPostId(links[2]), /^tiktok:share:[a-f0-9]{64}$/);
	const caption = socialPostCaption(content);
	assert.ok(caption.includes("/photo/456"));
	assert.ok(caption.includes(`||${url}||`));
	assert.ok(!caption.includes("vm.tiktok.com"));
	assert.ok(!caption.includes("x.com"));
});

test("TikTok uses a dedicated bounded Unix delivery route, not the X metadata route", async (context) => {
	const directory = await mkdtemp("/tmp/caitlyn-tiktok-wire-");
	const socket = `${directory}/worker.sock`;
	const wire = { ...await deliverTikTokPost(url, 1024, 2048, dependencies()), provider: "tiktok" };
	const service = await startSocialWorkerServer(socket, async (request, _signal, operation) => {
		assert.equal(request.url, url);
		assert.equal(operation, "delivery");
		return wire;
	});
	context.after(async () => {
		await service.stop();
		await rm(directory, { recursive: true, force: true });
	});
	assert.equal((await requestSocialWorker(socket, input)).outcome, "ready");
	assert.deepEqual(validateSocialWorkerRequest(input), input);
	assert.throws(() => validateSocialMetadataRequest({ version: 1, url }));
	assert.throws(() => validateSocialWorkerRequest({ ...input, url: "https://www.tiktok.com/@test/photo/123" }));
});

function storeFixture(sibling, overrides = {}) {
	const job = { id: "one", lease_token: "lease", guild_id: "111", channel_id: "222", source_id: "333", author_id: "444",
		status: "processing", source_hash: "hash", url: "https://vm.tiktok.com/Example/", post_id: "tiktok:share:fixture", ...overrides };
	const calls = [];
	const connection = { query: async (sql, values) => {
		calls.push([sql, values]);
		return { rows: sql.startsWith("SELECT *") ? [job, ...(sibling ? [{ ...job, ...sibling }] : [])] : [] };
	}, release: () => calls.push(["release"]) };
	return { job, calls, store: createSocialDeliveryStore({ connect: async () => connection }) };
}

test("TikTok share resolution saves the canonical URL without changing original queue identity", async () => {
	const f = storeFixture();
	assert.equal(await f.store.resolveTikTok(f.job, url), "send");
	assert.ok(f.calls.some(([sql]) => sql.includes("ORDER BY id FOR UPDATE")));
	assert.ok(f.calls.some(([sql, values]) => sql.startsWith("UPDATE") && values[2] === url));
	assert.ok(!f.calls.some(([sql]) => sql.includes("SET post_id")));
	assert.equal(f.calls.at(-1)[0], "release");
});

test("TikTok aliases reuse only confirmed complete same-source previews, never uncertain/partial sends", async () => {
	const sibling = { id: "two", url, status: "sent", message_id: "555", replacement_ready: true, source_cleanup: "pending" };
	const good = storeFixture(sibling);
	assert.equal(await good.store.resolveTikTok(good.job, url), "reused");
	assert.ok(good.calls.some(([sql, values]) => sql.includes("duplicate_reused") && values[3] === "555"));
	for (const changed of [{ status: "sending" }, { status: "uncertain" }, { status: "processing" }, { status: "removing" }, { replacement_ready: false },
		{ message_id: null }, { cancel_requested: true }, { source_hash: "changed" }, { author_id: "different" }, { source_cleanup: "deleted" }]) {
		const f = storeFixture({ ...sibling, ...changed });
		assert.equal(await f.store.resolveTikTok(f.job, url), "blocked");
		assert.ok(!f.calls.some(([sql]) => sql.startsWith("UPDATE")));
	}
	const stale = storeFixture(undefined, { cancel_requested: true });
	assert.equal(await stale.store.resolveTikTok(stale.job, url), "stale");
	await assert.rejects(stale.store.resolveTikTok(stale.job, "https://x.com/alice/status/123"));
});
