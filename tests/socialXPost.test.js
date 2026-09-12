/**
 * @file socialXPost.test.js
 * @description Exercises X text, media ordering, quote attribution, restrictions, and hostile metadata.
 * Uses synthetic provider responses only; never retrieves posts or starts the bot.
 *
 * @module socialXPost.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeXPost, xMediaUrl, xVideoCandidates } from "../core/socialXPost.ts";

function tweet(id = "123", handle = "alice", media = []) {
	return {
		__typename: "Tweet", rest_id: id,
		core: { user_results: { result: { legacy: { name: `${handle} name`, screen_name: handle } } } },
		legacy: { id_str: id, full_text: "A full post\nwith &amp; and &lt;text&gt;", truncated: false, extended_entities: { media } },
	};
}

function normalize(result, id = "123") {
	return normalizeXPost({ tweetResult: { result } }, id);
}

function photo(id = "501") {
	return { id_str: id, type: "photo", media_url_https: `https://pbs.twimg.com/media/photo_${id}.jpg?name=small`, original_info: { width: 600, height: 400 } };
}

function video(id = "502") {
	return {
		id_str: id, type: "video", video_info: { duration_millis: 60_000, variants: [
			{ content_type: "application/x-mpegURL", url: "https://video.twimg.com/a.m3u8" },
			{ content_type: "video/mp4", bitrate: 1_000_000, url: "https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/b.mp4?tag=1" },
			{ content_type: "video/mp4", bitrate: 256_000, url: "https://video.twimg.com/ext_tw_video/1/pu/vid/480x270/c.mp4?tag=1" },
		] },
	};
}

test("X text preserves line breaks, entities, author identity, and exact string IDs", () => {
	const id = "2097877698894770267";
	const input = tweet(id);
	const snapshot = structuredClone(input);
	const result = normalize(input, id);
	assert.equal(result.outcome, "ready");
	assert.equal(result.post.id, id);
	assert.equal(result.post.text, "A full post\nwith & and <text>");
	assert.equal(result.post.url, `https://x.com/alice/status/${id}`);
	assert.deepEqual(result.post.author, { name: "alice name", handle: "alice" });
	assert.deepEqual(input, snapshot);
});

test("X images use original URLs and keep gallery and mixed-media order", () => {
	const result = normalize(tweet("123", "alice", [photo(), video(), photo("503")]));
	assert.equal(result.outcome, "ready");
	assert.deepEqual(result.post.media.map((media) => media.id), ["501", "502", "503"]);
	assert.deepEqual(result.post.media.map((media) => media.kind), ["image", "video", "image"]);
	assert.equal(result.post.media[0].imageUrl, "https://pbs.twimg.com/media/photo_501.jpg?name=orig");
	assert.equal(result.post.media[1].variants.length, 2);
	assert.equal(result.post.media[1].durationSeconds, 60);
});

test("X quotes keep separate text, authors, and media instead of flattening videos", () => {
	const parent = tweet("123", "alice", [video()]);
	parent.legacy.quoted_status_id_str = "456";
	parent.quoted_status_result = { result: tweet("456", "bob", [photo("601"), video("602")]) };
	const result = normalize(parent);
	assert.equal(result.outcome, "ready");
	assert.equal(result.post.author.handle, "alice");
	assert.equal(result.post.quote.post.author.handle, "bob");
	assert.equal(result.post.quote.post.id, "456");
	assert.deepEqual(result.post.media.map((media) => media.id), ["502"]);
	assert.deepEqual(result.post.quote.post.media.map((media) => media.id), ["601", "602"]);
});

test("unavailable, mismatched, protected, and self quotes leave a partial parent", () => {
	for (const raw of [undefined, tweet("999"), { __typename: "TweetUnavailable", reason: "Protected" }, tweet("123")]) {
		const parent = tweet();
		parent.legacy.quoted_status_id_str = "456";
		parent.quoted_status_result = { result: raw };
		const result = normalize(parent);
		assert.equal(result.outcome, "partial");
		assert.equal(result.post.quote.state, "unavailable");
		assert.ok(result.post.issues.includes("quote_unavailable"));
	}
});

test("nested quotes stop after one level and explicitly mark the preview partial", () => {
	const parent = tweet();
	const quote = tweet("456", "bob");
	parent.legacy.quoted_status_id_str = "456";
	parent.quoted_status_result = { result: quote };
	quote.legacy.quoted_status_id_str = "123";
	quote.quoted_status_result = { result: parent };
	const result = normalize(parent);
	assert.equal(result.outcome, "partial");
	assert.ok(result.post.quote.post.issues.includes("nested_quote_omitted"));
	assert.equal(result.post.quote.post.quote, undefined);
});

test("X long-form text supersedes truncated legacy text and missing full text stays partial", () => {
	const input = tweet();
	input.legacy.truncated = true;
	assert.equal(normalize(input).outcome, "partial");
	input.note_tweet = { note_tweet_results: { result: { text: "full note\n".repeat(300) } } };
	assert.equal(normalize(input).post.text, input.note_tweet.note_tweet_results.result.text);
	assert.equal(normalize(input).outcome, "ready");
	input.note_tweet.note_tweet_results.result.text = undefined;
	assert.equal(normalize(input).post.textComplete, false);
	input.note_tweet.note_tweet_results.result.text = "a".repeat(25_001);
	assert.equal(normalize(input).post.text.length, 25_000);
	assert.equal(normalize(input).outcome, "partial");
});

test("X unavailable and restricted responses do not leak their text or return media", () => {
	for (const [input, outcome] of [
		[{ __typename: "TweetTombstone", tombstone: { text: "private detail" } }, "unavailable"],
		[{ __typename: "TweetUnavailable", reason: "Deleted" }, "unavailable"],
		[{ __typename: "TweetUnavailable", reason: "Protected" }, "restricted"],
		[{ __typename: "TweetUnavailable", reason: "NsfwLoggedOut" }, "restricted"],
	]) assert.deepEqual(normalize(input), { outcome });
	const input = tweet();
	input.legacy.possibly_sensitive = true;
	assert.deepEqual(normalize(input), { outcome: "restricted" });
	input.legacy.possibly_sensitive = false;
	input.core.user_results.result.legacy.protected = true;
	assert.deepEqual(normalize(input), { outcome: "restricted" });
});

test("X malformed identity and response shapes fail closed instead of attributing the wrong post", () => {
	for (const input of [null, [], {}, { __typename: "Unknown" }, tweet("999"), { ...tweet(), rest_id: "999" }]) {
		assert.deepEqual(normalize(input), { outcome: "invalid_response" });
	}
	assert.deepEqual(normalizeXPost({}, "123"), { outcome: "invalid_response" });
	assert.deepEqual(normalize(tweet(), "not-an-id"), { outcome: "invalid_response" });
	const input = tweet();
	input.legacy.id_str = 123;
	input.rest_id = 123;
	assert.deepEqual(normalize(input), { outcome: "invalid_response" });
});

test("X visibility wrappers and newer user-core identity fields are supported", () => {
	const input = tweet();
	input.core.user_results.result = { core: { name: "New name", screen_name: "new_name" } };
	assert.equal(normalize({ __typename: "TweetWithVisibilityResults", tweet: input }).post.author.handle, "new_name");
	input.core.user_results.result = {};
	const missing = normalize(input);
	assert.equal(missing.outcome, "partial");
	assert.equal(missing.post.url, "https://x.com/i/status/123");
});

test("X malformed, duplicate, excessive, and unknown media cannot masquerade as complete", () => {
	for (const media of [[null], [{}], [photo(), photo()], [{ ...photo(), type: "unknown" }], [photo(), photo("502"), photo("503"), photo("504"), photo("505")]]) {
		const result = normalize(tweet("123", "alice", media));
		assert.equal(result.outcome, "partial");
		assert.ok(result.post.media.length <= 4);
	}
	const input = tweet();
	input.legacy.extended_entities.media = {};
	assert.equal(normalize(input).outcome, "partial");
	input.card = { unsafe: "https://private.example" };
	assert.ok(normalize(input).post.issues.includes("unsupported_card"));
});

test("X CDN validation rejects private hosts, ambiguous paths, credentials, redirects, and HTML", () => {
	for (const url of [
		"http://pbs.twimg.com/media/a.jpg", "https://pbs.twimg.com.evil.test/media/a.jpg", "https://pbs.twimg.com@127.0.0.1/a.jpg",
		"https://pbs.twimg.com:443/media/a.jpg", "https://pbs.twimg.com./media/a.jpg", "https://100.70.173.118/media/a.jpg",
		"https://pbs.twimg.com/media/../a.jpg", "https://pbs.twimg.com/media/%2e%2e/a.jpg", "https://pbs.twimg.com/media/a.svg",
		"https://pbs.twimg.com/media/a.jpg#fragment", "https://pbs.twimg.com/media/a.jpg\n", "file:///tmp/a.jpg",
	]) assert.equal(xMediaUrl(url, "image"), undefined, url);
	assert.equal(xMediaUrl("https://video.twimg.com/a.m3u8", "video"), undefined);
	assert.equal(xMediaUrl("https://video.twimg.com/../a.mp4", "video"), undefined);
	assert.equal(xMediaUrl("https://pbs.twimg.com/media/a.mp4", "video"), undefined);
	const input = tweet("123", "alice", [{ ...photo(), media_url_https: "https://127.0.0.1/a.jpg" }]);
	assert.deepEqual(normalize(input).post.media, []);
	assert.equal(normalize(input).outcome, "partial");
});

test("X video planning prefers fitting quality, keeps unknown estimates bounded, and never mutates", () => {
	const media = normalize(tweet("123", "alice", [video()])).post.media[0];
	const snapshot = structuredClone(media);
	assert.equal(xVideoCandidates(media, 10 * 1_024 * 1_024)[0].height, 720);
	assert.equal(xVideoCandidates(media, 5 * 1_024 * 1_024)[0].height, 270);
	assert.deepEqual(xVideoCandidates(media, 1), []);
	for (const limit of [0, -1, Infinity, NaN, 0.5]) assert.deepEqual(xVideoCandidates(media, limit), []);
	assert.deepEqual(media, snapshot);
	media.durationSeconds = undefined;
	assert.equal(xVideoCandidates(media, 1).length, 2);
});

test("X Unicode caps preserve surrogate pairs and optional GraphQL truncation flags are handled", () => {
	const input = tweet();
	input.legacy.full_text = "a".repeat(24_999) + "😀";
	const result = normalize(input);
	assert.equal(result.outcome, "partial");
	assert.equal(result.post.text.length, 24_999);
	assert.equal(result.post.text.isWellFormed(), true);
	input.legacy.full_text = "a short post";
	delete input.legacy.truncated;
	assert.equal(normalize(input).post.textComplete, true);
	input.legacy.truncated = "unknown";
	assert.equal(normalize(input).post.textComplete, false);
});
