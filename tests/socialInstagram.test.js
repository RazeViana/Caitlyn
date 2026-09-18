/**
 * @file socialInstagram.test.js
 * @description Tests Instagram photo/reel/carousel normalization, sandbox delivery, private transport and attributed rendering.
 * Synthetic data only: no provider requests, account sessions or Discord writes.
 *
 * @module socialInstagram.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { instagramMediaUrl, instagramPk, normalizeInstagramPost } from "../core/socialInstagramPost.ts";
import { deliverInstagramPost } from "../scripts/mediaSandbox/instagramPostWorker.ts";
import { decodeSocialWorkerResult, requestSocialWorker, validateSocialWorkerRequest, validateSocialMetadataRequest } from "../core/socialWorkerClient.ts";
import { parseSocialLink, supportedSocialLink, socialPostCaption, socialJobPostId } from "../core/socialLinks.ts";
import { renderSocialPost } from "../core/socialPostRender.ts";
import { startSocialWorkerServer } from "../scripts/socialWorker/server.ts";
import { allowedTunnel } from "../scripts/mediaSandbox/gateway.ts";

const shortcode = "DdUCjIygdfq";
const url = `https://www.instagram.com/p/${shortcode}/`;
const cdn = "https://scontent.cdninstagram.com/fixture.jpg?signature=private";
const input = { version: 1, url, attachmentBytes: 1024, totalBytes: 2048 };
const imageBytes = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(24)]);
const videoBytes = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypisom"), Buffer.alloc(24)]);

function photo(pk = instagramPk(shortcode)) {
	return { pk, media_type: 1, image_versions2: { candidates: [{ url: cdn, width: 640, height: 480 }] }, accessibility_caption: "Synthetic photo" };
}

function video(pk = "22") {
	return { pk, media_type: 2, has_audio: true, video_duration: 4,
		video_versions: [{ url: "https://video.fbcdn.net/fixture.mp4?signature=private", width: 640, height: 480 }] };
}

function raw(nodes) {
	return { ...photo(), code: shortcode, user: { username: "test.creator", full_name: "Creator", is_private: false },
		caption: { text: "Caption @everyone" }, ...(nodes ? { media_type: 8, carousel_media: nodes, carousel_media_count: nodes.length } : {}) };
}

function dependencies(metadata = raw()) {
	const calls = [];
	return { calls, normalize: normalizeInstagramPost,
		retrieve: async (kind, candidate, limit) => {
			calls.push([kind, candidate, limit]);
			return kind === "metadata" ? metadata : { bytes: kind === "image" ? imageBytes.length : videoBytes.length, mime: kind === "image" ? "image/png" : "video/mp4" };
		},
		execute: async (command, args) => {
			calls.push([command, args]);
			assert.ok(args.includes("file,pipe"));
			return { stdout: command !== "ffprobe" ? "" : args.includes("/tmp/x-image.bin")
				? JSON.stringify({ streams: [{ codec_name: "png", width: 640, height: 480 }] })
				: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 480 }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "4" } }) };
		},
		readFile: async (path) => {
			assert.ok(["/tmp/x-image.bin", "/tmp/x-video.mp4"].includes(path));
			return path.endsWith(".bin") ? imageBytes : videoBytes;
		} };
}

test("owner Instagram URLs lose tracking but preserve shortcode case and shared queue identity", () => {
	for (const example of [url, "https://www.instagram.com/reel/DdGpKGeo7Lc/"]) {
		const link = parseSocialLink(`${example}?utm_source=ig_web_copy_link&stkn=fixture`);
		assert.equal(link.url, example);
		assert.equal(supportedSocialLink(link), true);
		assert.equal(socialJobPostId(link), `instagram:${link.id}`);
		assert.equal(socialPostCaption(`Look ${example}`), "Look");
		assert.equal(validateSocialWorkerRequest({ ...input, url: link.url }).url, example);
	}
	assert.equal(parseSocialLink(url.replace("/p/", "/reel/")).key, parseSocialLink(url).key);
	assert.equal(supportedSocialLink(parseSocialLink("https://www.instagram.com/share/reel/AbCd/")), false);
	assert.equal(supportedSocialLink(parseSocialLink(`https://www.instagram.com/p/${"a".repeat(29)}/`)), false);
	assert.equal(supportedSocialLink(parseSocialLink("https://www.reddit.com/comments/abc1/")), false);
	assert.throws(() => validateSocialMetadataRequest({ version: 1, url }), /invalid_metadata_request/);
});

test("Instagram preserves complete captions, attribution, original-size photos and all carousel types", () => {
	const value = raw([photo("11"), video(), photo("33")]);
	value.carousel_media[0].image_versions2.candidates.push({ url: cdn.replace("fixture", "large"), width: 1080, height: 1080 });
	const result = normalizeInstagramPost(value, url);
	assert.equal(result.outcome, "ready");
	assert.equal(result.post.text, "Caption @everyone");
	assert.equal(result.post.author.handle, "test.creator");
	assert.deepEqual(result.post.media.map((media) => [media.id, media.kind]), [["11", "image"], ["22", "video"], ["33", "image"]]);
	assert.equal(result.post.media[0].width, 1080);
	assert.equal(normalizeInstagramPost({ ...raw(), caption: null }, url).post.textComplete, true);
});

test("Instagram rejects mismatched identity, private posts, malformed media types and unsafe author names", () => {
	for (const changes of [{ pk: "123" }, { code: shortcode.toLowerCase() }, { user: { username: "../../secret" } }]) {
		assert.equal(normalizeInstagramPost({ ...raw(), ...changes }, url).outcome, "invalid_response");
	}
	assert.equal(normalizeInstagramPost({ ...raw(), user: { ...raw().user, is_private: true } }, url).outcome, "restricted");
	for (const media_type of ["1", 9, null, [], undefined]) assert.equal(normalizeInstagramPost({ ...raw(), media_type }, url).outcome, "unsupported");
});

test("logged-out URL-only image candidates rely on actual decoder dimensions instead of being dropped", async () => {
	const value = raw();
	value.image_versions2.candidates = [{ url: cdn }];
	const result = normalizeInstagramPost(value, url);
	assert.equal(result.outcome, "ready");
	assert.equal(result.post.media[0].width, undefined);
	assert.equal((await deliverInstagramPost(url, 1024, 2048, dependencies(value))).outcome, "ready");
	value.image_versions2.candidates = [{ url: cdn, width: -1, height: 1 }];
	assert.equal(normalizeInstagramPost(value, url).outcome, "partial");
});

test("missing text/items, duplicate children, missing video sources and media limits remain partial", () => {
	for (const changes of [{ caption: undefined }, { caption: { text: "x".repeat(25_001) } },
		{ media_type: 8, carousel_media: [photo("11")], carousel_media_count: 2 },
		{ media_type: 8, carousel_media: [photo("11"), photo("11")], carousel_media_count: 2 },
		{ media_type: 2, video_versions: [], image_versions2: raw().image_versions2 }]) {
		assert.equal(normalizeInstagramPost({ ...raw(), ...changes }, url).outcome, "partial");
	}
	const result = normalizeInstagramPost(raw(Array.from({ length: 9 }, (_, index) => photo(String(index + 1)))), url);
	assert.equal(result.outcome, "partial");
	assert.equal(result.post.media.length, 8);
	assert.ok(result.post.issues.includes("media_limit"));
});

test("Instagram CDN and per-platform gateway checks reject cross-platform and arbitrary destinations", () => {
	assert.equal(instagramMediaUrl(cdn), cdn);
	for (const candidate of ["http://scontent.cdninstagram.com/a", "https://cdninstagram.com.evil.test/a", "https://127.0.0.1/a",
		"https://user:secret@scontent.cdninstagram.com/a", "https://scontent.cdninstagram.com:443/a", "https://scontent.cdninstagram.com/../a",
		"https://scontent.cdninstagram.com/%2e%2e/a", "https://scontent.cdninstagram.com/a#fragment", "https://www.instagram.com/a", "file:///a"]) {
		assert.equal(instagramMediaUrl(candidate), undefined);
	}
	for (const host of ["www.instagram.com", "scontent.cdninstagram.com", "video.fbcdn.net"]) assert.equal(allowedTunnel(`${host}:443`, "instagram"), host);
	for (const host of ["www.reddit.com", "video.twimg.com", "www.tiktok.com", "api.fxtwitter.com"]) assert.equal(allowedTunnel(`${host}:443`, "instagram"), null);
});

test("Instagram delivers mixed attachments in order, strips CDN links and renders caption/shared-by inside the embed", async () => {
	const fake = dependencies(raw([photo("11"), video(), photo("33")]));
	const wire = { ...await deliverInstagramPost(url, 1024, 2048, fake), provider: "instagram" };
	const result = decodeSocialWorkerResult(wire, input);
	assert.equal(result.outcome, "ready");
	assert.deepEqual(result.files.map((file) => file.mediaId), ["11", "22", "33"]);
	assert.ok(!JSON.stringify(result).includes("signature"));
	const rendered = renderSocialPost(result.post, result.files, { attachmentBytes: 1024, messageBytes: 1024 * 1024 }, "123");
	assert.equal(rendered.complete, true);
	assert.equal(rendered.payload.embeds[0].color, 0xe1306c);
	assert.match(rendered.payload.embeds[0].description, /Instagram · 2 images · Video/);
	assert.match(rendered.payload.embeds[0].description, /Shared by <@123>/);
	assert.match(rendered.payload.embeds[0].description, /Caption @\u200Beveryone/);
	assert.deepEqual(rendered.payload.files.map((file) => file.name), ["instagram-post-image-1.png", "instagram-post-video-2.mp4", "instagram-post-image-3.png"]);
});

test("unknown video audio must be verified; only explicitly silent clips can omit audio", async () => {
	for (const has_audio of [undefined, true, false]) {
		const metadata = { ...raw(), ...video(instagramPk(shortcode)), has_audio };
		const fake = dependencies(metadata);
		fake.execute = async (command) => ({ stdout: command === "ffprobe" ? JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 480 }], format: { duration: "4" } }) : "" });
		const result = await deliverInstagramPost(url, 1024, 2048, fake);
		assert.equal(result.outcome, has_audio === false ? "ready" : "partial");
		if (has_audio !== false) assert.deepEqual(result.mediaFailures, ["audio_unverified"]);
	}
});

test("access failures halt a carousel without alternate fetches or source deletion", async () => {
	for (const reason of ["access_denied", "rate_limited", "timeout", "redirect_denied"]) {
		const fake = dependencies(raw([video("11"), photo("22")]));
		fake.retrieve = async (kind) => {
			fake.calls.push([kind]);
			if (kind === "metadata") return raw([video("11"), photo("22")]);
			throw new Error(reason);
		};
		const result = await deliverInstagramPost(url, 1024, 2048, fake);
		assert.equal(result.outcome, "partial");
		assert.deepEqual(result.mediaFailures, [reason, "not_attempted"]);
		assert.deepEqual(fake.calls, [["metadata"], ["video"]]);
		assert.equal(renderSocialPost(result.post, [], { attachmentBytes: 1024, messageBytes: 1024 * 1024 }).complete, false);
	}
	const fake = dependencies(raw([photo("11"), video("22")]));
	fake.retrieve = async (kind) => {
		fake.calls.push([kind]);
		if (kind === "metadata") return raw([photo("11"), video("22")]);
		throw new Error("restricted");
	};
	assert.deepEqual((await deliverInstagramPost(url, 1024, 2048, fake)).mediaFailures, ["restricted", "not_attempted"]);
	assert.deepEqual(fake.calls, [["metadata"], ["image"]]);
});

test("Instagram aggregate and per-file budgets reject overflow and propagate shared compression", async () => {
	const fake = dependencies(raw([photo("11"), photo("22"), photo("33")]));
	fake.retrieve = async (kind) => kind === "metadata" ? raw([photo("11"), photo("22"), photo("33")]) : { bytes: 1024, mime: "image/png" };
	fake.readFile = async () => Buffer.alloc(1024);
	const result = await deliverInstagramPost(url, 1024, 2048, fake);
	assert.equal(result.outcome, "partial");
	assert.equal(result.files.length, 2);
	assert.deepEqual(result.mediaFailures, ["size_limit"]);
	const large = dependencies({ ...raw(), ...video(instagramPk(shortcode)) });
	large.retrieve = async (kind, _url, limit) => {
		if (kind === "metadata") return { ...raw(), ...video(instagramPk(shortcode)) };
		if (limit < 48 * 1024 * 1024) throw new Error("size_limit");
		return { bytes: 100_000, mime: "video/mp4" };
	};
	large.compress = async () => ({ outcome: "video_verified", bytes: videoBytes.length, compressed: true });
	const compressed = await deliverInstagramPost(url, 64 * 1024, 128 * 1024, large);
	assert.equal(compressed.files[0].compressed, true);
});

test("Instagram wire identity, attachment ownership, provider and quote contracts are strict", async () => {
	const wire = { ...await deliverInstagramPost(url, 1024, 2048, dependencies()), provider: "instagram" };
	for (const mutate of [
		(value) => { value.provider = "tiktok"; }, (value) => { delete value.provider; },
		(value) => { value.post.id = shortcode.toLowerCase(); }, (value) => { value.post.url = url.replace("/p/", "/reel/"); },
		(value) => { value.files[0].postId = "123"; }, (value) => { value.files[0].mediaId = "999"; },
		(value) => { value.post.quote = { state: "unavailable" }; }, (value) => { value.post.media.push(value.post.media[0]); },
	]) {
		const value = structuredClone(wire);
		mutate(value);
		assert.equal(decodeSocialWorkerResult(value, input).outcome, "invalid_response");
	}
	assert.equal(decodeSocialWorkerResult({ outcome: "restricted", provider: "instagram", diagnostic: {} }, input).outcome, "invalid_response");
	assert.equal(decodeSocialWorkerResult({ outcome: "unavailable", provider: "instagram", instagramReason: "page_metadata_missing" }, input).instagramReason, "page_metadata_missing");
	for (const reason of ["secret provider text", {}, [], "https://secret.test", "constructor"]) {
		assert.equal(decodeSocialWorkerResult({ outcome: "unavailable", provider: "instagram", instagramReason: reason }, input).outcome, "invalid_response");
	}
});

test("Instagram uses its own private Unix route without changing X metadata or Reddit admission", async (context) => {
	const directory = await mkdtemp("/tmp/caitlyn-ig-test-");
	const socket = `${directory}/worker.sock`;
	const wire = { ...await deliverInstagramPost(url, 1024, 2048, dependencies()), provider: "instagram" };
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
});
