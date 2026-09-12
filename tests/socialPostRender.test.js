/**
 * @file socialPostRender.test.js
 * @description Tests safe X Discord payloads, attribution, full-text fallbacks, and upload budgets.
 * Uses synthetic buffers and never sends messages, downloads files, or mutates originals.
 *
 * @module socialPostRender.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderXPost } from "../core/socialPostRender.ts";

const limits = { attachmentBytes: 1_000_000, messageBytes: 2_000_000 };

function post(id = "123", handle = "alice", count = 1) {
	return {
		id, url: `https://x.com/${handle}/status/${id}`, author: { name: handle, handle }, text: "A sample post", textComplete: true, issues: [],
		media: Array.from({ length: count }, (_, index) => ({ id: String(index + 501), kind: "image", variants: [], imageUrl: "https://pbs.twimg.com/media/image.jpg?name=orig" })),
	};
}

function attached(item) {
	return item.media.map((media) => ({ postId: item.id, mediaId: media.id, extension: "jpg", data: Buffer.alloc(50) }));
}

test("X rendering uses only provided bytes, disables mentions, and keeps source state unchanged", () => {
	const input = post();
	input.text = "@everyone <@123> **bold** [fake](https://evil.test) ||hidden||";
	const before = structuredClone(input);
	const result = renderXPost(input, attached(input), limits);
	assert.deepEqual(result.payload.allowedMentions, { parse: [], repliedUser: false });
	assert.ok(result.payload.embeds[0].description.includes("@\u200Beveryone"));
	assert.ok(!result.payload.embeds[0].description.includes("<@123>"));
	assert.ok(result.payload.embeds[0].description.includes("\\*\\*bold"));
	assert.equal(result.payload.embeds[0].image.url, "attachment://x-123-501.jpg");
	assert.ok(Buffer.isBuffer(result.payload.files[0].attachment));
	assert.deepEqual(input, before);
});

test("X galleries and quotes remain ordered and attributed even when media IDs overlap", () => {
	const input = post("123", "alice", 4);
	const quote = post("456", "bob", 4);
	input.quote = { state: "available", post: quote };
	const result = renderXPost(input, [...attached(quote), ...attached(input)], limits);
	assert.equal(result.omittedMedia, 0);
	assert.equal(result.payload.embeds.length, 8);
	assert.equal(result.payload.embeds[0].title, "Post on X");
	assert.equal(result.payload.embeds[4].title, "Quoted post on X");
	assert.ok(result.payload.embeds[4].author.name.includes("bob"));
	assert.deepEqual(result.payload.files.map((file) => file.name), [
		"x-123-501.jpg", "x-123-502.jpg", "x-123-503.jpg", "x-123-504.jpg",
		"x-456-501.jpg", "x-456-502.jpg", "x-456-503.jpg", "x-456-504.jpg",
	]);
});

test("X long text gets an attributed text attachment while all embed limits remain bounded", () => {
	const input = post("123", "alice", 4);
	const quote = post("456", "bob", 4);
	input.text = "😀*\\".repeat(5_000);
	quote.text = "long quote ".repeat(2_000);
	input.author.name = "a".repeat(200);
	quote.author.name = "b".repeat(200);
	input.quote = { state: "available", post: quote };
	const result = renderXPost(input, [...attached(input), ...attached(quote)], limits);
	assert.equal(result.textFileAttached, true);
	assert.equal(result.payload.files.length, 9);
	const text = result.payload.files[0].attachment.toString("utf8");
	assert.ok(text.includes(input.text));
	assert.ok(text.includes(quote.text));
	assert.ok(text.includes("Quoted post: https://x.com/bob/status/456"));
	let total = 0;
	for (const embed of result.payload.embeds) {
		assert.ok((embed.description?.length ?? 0) <= 4_096);
		assert.ok((embed.author?.name.length ?? 0) <= 256);
		total += (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.author?.name.length ?? 0) + (embed.footer?.text.length ?? 0);
	}
	assert.ok(total <= 6_000);
	assert.ok(result.payload.embeds.length <= 10);
});

test("X oversized files, remote URL inputs, wrong types, and cross-post files are omitted explicitly", () => {
	const input = post();
	for (const files of [
		[], [{ ...attached(input)[0], data: "https://evil.test/file.jpg" }],
		[{ ...attached(input)[0], data: Buffer.alloc(limits.attachmentBytes + 1) }],
		[{ ...attached(input)[0], postId: "999" }], [{ ...attached(input)[0], extension: "mp4" }],
	]) {
		const result = renderXPost(input, files, limits);
		assert.equal(result.omittedMedia, 1);
		assert.equal(result.payload.files.length, 0);
		assert.ok(result.payload.embeds[0].description.includes("could not be attached"));
		assert.equal(result.payload.embeds[0].image, undefined);
	}
});

test("X aggregate upload budget reserves payload space and never silently loses long text", () => {
	const input = post("123", "alice", 4);
	const result = renderXPost(input, attached(input), { ...limits, messageBytes: 128 * 1_024 + 120 });
	assert.equal(result.payload.files.length, 2);
	assert.equal(result.omittedMedia, 2);
	input.text = "long text ".repeat(400);
	const shortened = renderXPost(input, [], { ...limits, attachmentBytes: 1 });
	assert.equal(shortened.textFileAttached, false);
	assert.ok(shortened.payload.embeds[0].description.includes("Text shortened; open the original"));
	assert.throws(() => renderXPost(input, [], { ...limits, messageBytes: 1 }), /invalid_social_render_limits/);
});

test("X incomplete sources and missing quotes are labelled; video bytes never become fake embed video URLs", () => {
	const input = post();
	input.textComplete = false;
	input.issues = ["incomplete_text", "quote_unavailable"];
	input.quote = { state: "unavailable", id: "456" };
	input.media[0].kind = "video";
	const result = renderXPost(input, [{ ...attached(input)[0], extension: "mp4" }], limits);
	assert.equal(result.omittedMedia, 0);
	assert.equal(result.payload.embeds[0].video, undefined);
	assert.equal(result.payload.embeds[0].image, undefined);
	assert.ok(result.payload.embeds[0].description.includes("quoted post is unavailable"));
	assert.ok(result.payload.embeds[0].description.includes("did not provide complete text"));
	assert.equal(result.payload.files[0].name, "x-123-501.mp4");
});
