/**
 * @file socialPostRender.test.js
 * @description Tests caption-first, content-aware Discord cards, safe attribution, and upload budgets.
 * Uses synthetic buffers and never sends messages, downloads files, or mutates originals.
 *
 * @module socialPostRender.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderSocialPost, renderXPost } from "../core/socialPostRender.ts";

const limits = { attachmentBytes: 1_000_000, messageBytes: 2_000_000 };

function post(id = "123", handle = "alice", count = 1) {
	return {
		id, url: `https://x.com/${handle}/status/${id}`, author: { name: handle, handle }, text: "A sample post", textComplete: true, issues: [],
		media: Array.from({ length: count }, (_, index) => ({ id: String(index + 501), kind: "image", variants: [], imageUrl: "https://pbs.twimg.com/media/image.jpg?name=orig" })),
	};
}

function attached(item) {
	return item.media.map((media) => ({ postId: item.id, mediaId: media.id, extension: media.kind === "image" ? "jpg" : "mp4", data: Buffer.alloc(50) }));
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
	assert.equal(result.payload.embeds[0].image.url, "attachment://x-post-image-1.jpg");
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
	assert.equal(result.payload.embeds[0].title, undefined);
	assert.ok(result.payload.embeds[0].description.includes("X · Quote · 4 images · [Original ↗]"));
	assert.equal(result.payload.embeds[4].title, undefined);
	assert.ok(result.payload.embeds[4].description.includes("X · Quoted post · 4 images"));
	assert.equal(result.footerEmbedIndex, 4);
	assert.ok(result.payload.embeds[4].author.name.includes("bob"));
	assert.notEqual(result.payload.embeds[0].color, result.payload.embeds[4].color);
	assert.equal(result.payload.embeds[1].footer.text, "Image 2/4 • @alice");
	assert.equal(result.payload.embeds[5].footer.text, "Quoted image 2/4 • @bob");
	assert.equal(result.payload.embeds[1].url, undefined);
	assert.equal(result.payload.embeds[5].url, undefined);
	assert.deepEqual(result.payload.files.map((file) => file.name), [
		"x-post-image-1.jpg", "x-post-image-2.jpg", "x-post-image-3.jpg", "x-post-image-4.jpg",
		"x-quote-image-1.jpg", "x-quote-image-2.jpg", "x-quote-image-3.jpg", "x-quote-image-4.jpg",
	]);
});

test("captions lead the card and the original link is compact, without a large link title", () => {
	const input = post("123", "alice_test");
	input.author.name = "Alice * Test\n\u202EName";
	const result = renderXPost(input, attached(input), limits);
	const card = result.payload.embeds[0];
	assert.equal(card.author.name, "Alice * Test Name (@alice_test)");
	assert.equal(card.author.url, input.url);
	assert.equal(card.url, input.url);
	assert.equal(card.title, undefined);
	assert.equal(result.payload.content, undefined);
	assert.equal(card.description, `A sample post\n\nX · Image · [Original ↗](${input.url})`);
	assert.ok(!card.description.replace(`[Original ↗](${input.url})`, "Original ↗").includes(input.url));
});

test("media-only cards omit empty-text filler without losing partial-media warnings", () => {
	const input = post();
	input.text = " \n\t ";
	const result = renderXPost(input, attached(input), limits);
	assert.equal(result.payload.embeds[0].description, `X · Image · [Original ↗](${input.url})`);
	assert.ok(result.payload.embeds[0].image);
	assert.equal(result.complete, true);
	const missing = renderXPost(input, [], limits);
	assert.equal(missing.payload.embeds[0].description, `1 media item(s) could not be attached; open the original.\n\nX · Image · [Original ↗](${input.url})`);
	assert.equal(missing.complete, false);
	input.media[0].kind = "video";
	const video = renderXPost(input, [{ ...attached(input)[0], extension: "mp4" }], limits);
	assert.equal(video.payload.embeds[0].description, `X · Video · [Original ↗](${input.url})`);
	assert.equal(video.payload.embeds[0].video, undefined);
	assert.equal(video.payload.files[0].name, "x-post-video-1.mp4");
	assert.equal(video.complete, true);
});

test("X long text gets an attributed text attachment while all embed limits remain bounded", () => {
	const input = post("123", "alice", 4);
	const quote = post("456", "bob", 4);
	input.text = "😀*\\".repeat(5_000);
	quote.text = "long quote ".repeat(2_000);
	input.author.name = "a".repeat(200);
	quote.author.name = "b".repeat(200);
	input.quote = { state: "available", post: quote };
	const result = renderXPost(input, [...attached(input), ...attached(quote)], limits, "12345678901234567890");
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
	assert.equal(result.payload.files[0].name, "x-post-video-1.mp4");
});

test("video, GIF, and mixed-media captions keep playback attachments and truthful format labels", () => {
	for (const [kinds, label] of [
		[["video"], "Video"], [["gif"], "GIF"], [["video", "video"], "2 videos"],
		[["image", "video", "gif"], "Image · Video · GIF"], [["image", "image"], "2 images"],
	]) {
		const input = post("123", "alice", kinds.length);
		input.media.forEach((media, index) => { media.kind = kinds[index]; });
		const result = renderXPost(input, attached(input), limits);
		assert.equal(result.payload.embeds[0].description, `A sample post\n\nX · ${label} · [Original ↗](${input.url})`);
		assert.equal(result.payload.files.length, kinds.length);
		assert.equal(result.payload.embeds[0].video, undefined);
		assert.equal(result.complete, true);
		if (!kinds.includes("image")) assert.equal(result.payload.embeds[0].image, undefined);
	}
});

test("text-only cards use a larger reading area while media captions retain full-text fallback", () => {
	const input = post("123", "alice", 0);
	input.text = "a".repeat(3_000);
	const text = renderXPost(input, [], limits);
	assert.equal(text.payload.embeds[0].description, `${input.text}\n\nX · Text · [Original ↗](${input.url})`);
	assert.equal(text.payload.embeds[0].image, undefined);
	assert.equal(text.payload.files.length, 0);
	assert.equal(text.textFileAttached, false);
	assert.equal(text.complete, true);
	input.media = post().media;
	const caption = renderXPost(input, attached(input), limits);
	assert.ok(caption.payload.embeds[0].description.startsWith(`${"a".repeat(1_799)}…`));
	assert.equal(caption.textFileAttached, true);
	assert.equal(caption.payload.files[0].name, "x-post-text.txt");
	assert.ok(caption.payload.files[0].attachment.toString().includes(input.text));
	assert.equal(caption.complete, true);
});

test("text truncation boundaries preserve full text, emoji pairs, and explicit partial notices", () => {
	const input = post("123", "alice", 0);
	input.text = `${"a".repeat(3_598)}😀`;
	assert.equal(renderXPost(input, [], limits).textFileAttached, false);
	input.text += "z";
	const result = renderXPost(input, [], limits);
	assert.equal(result.textFileAttached, true);
	assert.ok(result.payload.embeds[0].description.startsWith(`${"a".repeat(3_598)}…`));
	assert.ok(result.payload.embeds[0].description.length <= 4_096);
	const partial = renderXPost(input, [], { ...limits, attachmentBytes: 1 });
	assert.equal(partial.complete, false);
	assert.ok(partial.payload.embeds[0].description.includes("Text shortened"));
	assert.ok(partial.payload.embeds[0].description.endsWith(`[Original ↗](${input.url})`));
});

test("quotes keep commentary and quoted text/media distinct, including captionless quotes", () => {
	const input = post("123", "alice", 0);
	const quote = post("456", "bob");
	input.text = "My thoughts";
	quote.text = "The original caption";
	quote.media[0].kind = "video";
	input.quote = { state: "available", post: quote };
	const result = renderXPost(input, attached(quote), limits);
	assert.equal(result.payload.embeds[0].description, `My thoughts\n\nX · Quote · [Original ↗](${input.url})`);
	assert.equal(result.payload.embeds[1].title, undefined);
	assert.equal(result.payload.embeds[1].description, `The original caption\n\nX · Quoted post · Video · [Original ↗](${quote.url})`);
	assert.equal(result.payload.embeds[1].author.url, quote.url);
	assert.equal(result.payload.files[0].name, "x-quote-video-1.mp4");
	assert.equal(result.complete, true);
	input.text = "";
	quote.text = "";
	const empty = renderXPost(input, attached(quote), limits);
	assert.ok(!empty.payload.embeds.some((embed) => embed.description.includes("No text supplied")));
	input.quote = { state: "unavailable" };
	input.issues = ["quote_unavailable"];
	const unavailable = renderXPost(input, [], limits);
	assert.ok(unavailable.payload.embeds[0].description.includes("quoted post is unavailable"));
	assert.ok(unavailable.payload.embeds[0].description.includes("X · Quote · [Original ↗]"));
	assert.equal(unavailable.complete, false);
});

test("missing gallery images retain original numbering and never reuse another post's files", () => {
	const input = post("123", "alice", 4);
	const result = renderXPost(input, attached(input).filter((_, index) => index !== 1), limits);
	assert.equal(result.payload.embeds[1].footer.text, "Image 3/4 • @alice");
	assert.equal(result.payload.embeds[2].footer.text, "Image 4/4 • @alice");
	assert.equal(result.omittedMedia, 1);
	assert.equal(result.complete, false);
	assert.deepEqual(result.payload.files.map((file) => file.name), ["x-post-image-1.jpg", "x-post-image-3.jpg", "x-post-image-4.jpg"]);
});

test("two long partial cards and attributed galleries stay inside Discord's aggregate limits", () => {
	const input = post("123", "alice", 4);
	const quote = post("456", "bob", 4);
	input.quote = { state: "available", post: quote };
	for (const item of [input, quote]) {
		item.text = "long text ".repeat(500);
		item.textComplete = false;
		item.author.name = "author ".repeat(80);
		item.issues = ["incomplete_text", "unsupported_card"];
	}
	const result = renderXPost(input, [...attached(input), ...attached(quote)].filter((file) => file.mediaId !== "501"), limits, "12345678901234567890");
	result.payload.embeds[result.footerEmbedIndex].footer = { text: "Caitlyn preview" };
	let total = 0;
	for (const embed of result.payload.embeds) {
		assert.ok((embed.description?.length ?? 0) <= 4_096);
		total += (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.author?.name.length ?? 0) + (embed.footer?.text.length ?? 0);
	}
	assert.ok(total <= 6_000);
	assert.equal(result.complete, false);
});

test("sender attribution appears once below the content for X images/videos/text/quotes and TikTok", () => {
	for (const type of ["image", "video", "text", "quote", "tiktok"]) {
		const input = post("123", "alice", ["text", "quote"].includes(type) ? 0 : 1);
		if (type === "video" || type === "tiktok") input.media[0].kind = "video";
		if (type === "tiktok") {
			input.platform = "tiktok";
			input.url = "https://www.tiktok.com/@alice/video/123";
		}
		const quoted = post("456", "bob");
		if (type === "quote") input.quote = { state: "available", post: quoted };
		const result = renderSocialPost(input, [...attached(input), ...attached(quoted)], limits, "444");
		const finalPost = type === "quote" ? quoted : input;
		assert.ok(result.payload.embeds[result.footerEmbedIndex].description.endsWith(`[Original ↗](${finalPost.url})\n\nShared by <@444>`));
		assert.equal(JSON.stringify(result.payload.embeds).split("Shared by <@444>").length - 1, 1);
		assert.equal(result.payload.content, undefined);
		assert.equal(result.complete, true);
		assert.deepEqual(result.payload.allowedMentions, { parse: [], repliedUser: false });
		if (type === "quote") {
			assert.equal(result.payload.embeds[1].author.name, "bob (@bob)");
			assert.ok(!result.payload.embeds[0].description.includes("Shared by"));
		}
	}
});

test("sender attribution rejects arbitrary names, Markdown, mentions, and invalid IDs", () => {
	const input = post();
	for (const sender of ["", "0", "-1", "444\n", "@everyone", "<@444>", "444> @everyone", "1".repeat(21), 444, null]) {
		assert.throws(() => renderSocialPost(input, attached(input), limits, sender), /invalid_social_sender/);
	}
	assert.ok(!renderSocialPost(input, attached(input), limits).payload.embeds[0].description.includes("Shared by"));
});

test("quote stacks keep the quoting tweet on top and sharing metadata below the quoted content", () => {
	for (const parentImages of [0, 1, 4]) {
		for (const quotedImages of [0, 1, 4]) {
			const input = post("123", "alice", parentImages);
			const quoted = post("456", "bob", quotedImages);
			input.text = "Alice's commentary";
			quoted.text = "Bob's original content";
			input.quote = { state: "available", post: quoted };
			const result = renderSocialPost(input, [...attached(quoted), ...attached(input)], limits, "444");
			const quoteIndex = Math.max(1, parentImages);
			assert.equal(result.footerEmbedIndex, quoteIndex);
			const first = result.payload.embeds[0];
			const quoteCard = result.payload.embeds[quoteIndex];
			assert.equal(first.author.name, "alice (@alice)");
			assert.ok(first.description.startsWith(input.text));
			assert.equal(first.footer, undefined);
			assert.ok(!first.description.includes("Shared by"));
			assert.equal(quoteCard.author.name, "bob (@bob)");
			assert.ok(quoteCard.description.startsWith(quoted.text));
			assert.ok(quoteCard.description.endsWith("Shared by <@444>"));
			assert.equal(quoteCard.title, undefined);
			assert.equal(quoteCard.color, 0x747f8d);
			assert.equal(result.complete, true);
		}
	}
	const unavailable = post("123", "alice", 0);
	unavailable.quote = { state: "unavailable" };
	unavailable.issues = ["quote_unavailable"];
	const partial = renderSocialPost(unavailable, [], limits, "444");
	assert.equal(partial.footerEmbedIndex, 0);
	assert.ok(partial.payload.embeds[0].description.endsWith("Shared by <@444>"));
	assert.equal(partial.complete, false);
});
