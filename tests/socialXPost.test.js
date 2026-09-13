/**
 * @file socialXPost.test.js
 * @description Exercises X text, media ordering, quote attribution, restrictions, and hostile metadata.
 * Uses synthetic provider responses only; never retrieves posts or starts the bot.
 *
 * @module socialXPost.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeXPost, sanitizeXPostDiagnostic, xMediaUrl, xVideoCandidates } from "../core/socialXPost.ts";

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

test("public sensitive metadata requires opt-in but actual X age/login/protection gates remain blocked", () => {
	const result = tweet("123", "alice", [photo()]);
	result.legacy.possibly_sensitive = true;
	assert.equal(normalize(result).outcome, "restricted");
	const allowed = normalizeXPost({ tweetResult: { result } }, "123", true);
	assert.equal(allowed.outcome, "ready");
	assert.equal(allowed.post.sensitive, true);
	assert.equal(allowed.post.media.length, 1);
	for (const reason of ["Protected", "NsfwLoggedOut", "NsfwViewerHasNoStatedAge"]) {
		assert.equal(normalizeXPost({ tweetResult: { result: { __typename: "TweetUnavailable", reason } } }, "123", true).outcome, "restricted");
	}
	result.core.user_results.result.legacy.protected = true;
	assert.equal(normalizeXPost({ tweetResult: { result } }, "123", true).outcome, "restricted");
});

test("sensitive quoted posts carry a separate sensitivity marker", () => {
	const parent = tweet();
	parent.legacy.quoted_status_id_str = "456";
	const quote = tweet("456", "bob", [photo()]);
	quote.legacy.possibly_sensitive = true;
	parent.quoted_status_result = { result: quote };
	assert.equal(normalize(parent).post.quote.state, "unavailable");
	const allowed = normalizeXPost({ tweetResult: { result: parent } }, "123", true);
	assert.equal(allowed.post.quote.post.sensitive, true);
});

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
	]) {
		const result = normalize(input);
		assert.equal(result.outcome, outcome);
		assert.equal(result.post, undefined);
		assert.ok(!JSON.stringify(result).includes("private detail"));
	}
	const input = tweet();
	input.legacy.possibly_sensitive = true;
	assert.equal(normalize(input).diagnostic.reason, "sensitive_disabled");
	input.legacy.possibly_sensitive = false;
	input.core.user_results.result.legacy.protected = true;
	assert.equal(normalize(input).diagnostic.reason, "protected");
});

test("X malformed identity and response shapes fail closed instead of attributing the wrong post", () => {
	for (const input of [null, [], {}, { __typename: "Unknown" }, tweet("999"), { ...tweet(), rest_id: "999" }]) {
		assert.equal(normalize(input).outcome, "invalid_response");
	}
	assert.equal(normalizeXPost({}, "123").diagnostic.reason, "unexpected_response");
	assert.deepEqual(normalize(tweet(), "not-an-id"), { outcome: "invalid_response" });
	const input = tweet();
	input.legacy.id_str = 123;
	input.rest_id = 123;
	assert.equal(normalize(input).diagnostic.reason, "identity_mismatch");
});

test("a bare X tombstone remains unknown, not assumed deleted or age-gated", () => {
	const result = normalize({ __typename: "TweetTombstone" });
	assert.deepEqual(result, { outcome: "unavailable", diagnostic: {
		stage: "metadata", responseType: "TweetTombstone", reason: "unknown_tombstone", source: "response_shape",
		hasLegacy: false, hasTombstoneText: false,
	} });
});

test("X reason codes distinguish login, age, protection, and deletion without echoing unknown codes", () => {
	for (const [reason, expected, outcome] of [
		["NsfwLoggedOut", "login_required", "restricted"], ["NsfwViewerHasNoStatedAge", "age_required", "restricted"],
		["Protected", "protected", "restricted"], ["Deleted", "deleted", "unavailable"],
		["private reason https://example.test?token=secret", "unknown_unavailable", "unavailable"],
	]) {
		const result = normalize({ __typename: "TweetUnavailable", reason });
		assert.equal(result.outcome, outcome);
		assert.equal(result.diagnostic.reason, expected);
		assert.equal(result.diagnostic.source, expected === "unknown_unavailable" ? "response_shape" : "reason_code");
		assert.equal(result.post, undefined);
		assert.ok(!JSON.stringify(result).includes("secret"));
	}
});

test("X tombstone text and richText shapes yield bounded diagnostics, never media", () => {
	for (const notice of [
		{ tombstone: { text: { text: "To view this media, you'll need to log in to Twitter." } } },
		{ tombstone: { richText: { text: "To view this media, you’ll need to log in to X." } } },
		{ tombstone: { text: "To view this media, you'll need to log in to X." } },
		{ text: { text: "To view this media, you'll need to log in to X." } },
		{ richText: { text: "To view this media, you'll need to log in to X." } },
		{ text: "To view this media, you'll need to log in to X." },
	]) {
		const input = { ...tweet("123", "alice", [video()]), __typename: "TweetTombstone", ...notice };
		const snapshot = structuredClone(input);
		const result = normalizeXPost({ tweetResult: { result: input } }, "123", true);
		assert.equal(result.outcome, "restricted");
		assert.equal(result.diagnostic.reason, "login_required");
		assert.equal(result.diagnostic.source, "tombstone_text");
		assert.equal(result.diagnostic.hasLegacy, true);
		assert.equal(result.diagnostic.hasTombstoneText, true);
		assert.equal(result.post, undefined);
		assert.ok(!JSON.stringify(result).includes("twimg.com"));
		assert.deepEqual(input, snapshot);
	}
});

test("X notice wording identifies only recognized restrictions and availability states", () => {
	for (const [text, reason, outcome] of [
		["Age-restricted adult content. Learn more", "age_required", "restricted"],
		["This Post is from a protected account.", "protected", "restricted"],
		["This Tweet was deleted by the Tweet author. Learn more", "deleted", "unavailable"],
		["This Post is from an account that no longer exists. Learn more", "author_unavailable", "unavailable"],
		["This Post is unavailable. Learn more", "unavailable", "unavailable"],
		["This may be a login or age error, or not", "unknown_tombstone", "unavailable"],
		["Unbekannter Fehler", "unknown_tombstone", "unavailable"],
	]) {
		const result = normalize({ __typename: "TweetTombstone", tombstone: { richText: { text } } });
		assert.equal(result.outcome, outcome);
		assert.equal(result.diagnostic.reason, reason);
		assert.equal(result.diagnostic.source, reason === "unknown_tombstone" ? "response_shape" : "tombstone_text");
	}
});

test("structured X reasons take precedence and wrapper tombstones are never discarded", () => {
	const notice = { text: { text: "This Post was deleted." } };
	const explicit = normalize({ __typename: "TweetTombstone", reason: "NsfwLoggedOut", tombstone: notice });
	assert.equal(explicit.diagnostic.reason, "login_required");
	assert.equal(explicit.diagnostic.source, "reason_code");
	const wrapper = { __typename: "TweetWithVisibilityResults", tombstone: notice, tweet: tweet() };
	assert.equal(normalize(wrapper).diagnostic.reason, "deleted");
	assert.equal(normalize(wrapper).post, undefined);
	delete wrapper.tombstone;
	wrapper.tweet = { __typename: "TweetUnavailable", reason: "NsfwViewerHasNoStatedAge" };
	assert.equal(normalize(wrapper).diagnostic.reason, "age_required");
});

test("X diagnostics ignore oversized or malformed notices and never scan post content", () => {
	for (const notice of ["This Post was deleted." + "x".repeat(1_025), 42, {}, [], null]) {
		const result = normalize({ __typename: "TweetTombstone", tombstone: { text: notice }, legacy: {
			full_text: "To view this media, you'll need to log in to X.",
		} });
		assert.equal(result.diagnostic.reason, "unknown_tombstone");
		assert.equal(result.diagnostic.hasTombstoneText, false);
	}
	const result = normalize({ __typename: "secret\nhttps://example.test", reason: "secret", legacy: {} });
	assert.equal(result.outcome, "invalid_response");
	assert.equal(result.diagnostic.responseType, "unknown");
	assert.ok(!JSON.stringify(result).includes("secret"));
});

test("newer X privacy flags and subscriber-only preview types remain restricted", () => {
	const input = tweet();
	input.core.user_results.result.privacy = { protected: true };
	assert.equal(normalize(input).outcome, "restricted");
	assert.equal(normalize(input).diagnostic.reason, "protected");
	assert.equal(normalize({ __typename: "TweetPreviewDisplay", tweet: tweet() }).diagnostic.reason, "subscription_required");
});

test("X diagnostic sanitization copies only known enums and booleans", () => {
	const diagnostic = normalize({ __typename: "TweetTombstone" }).diagnostic;
	assert.deepEqual(sanitizeXPostDiagnostic({ ...diagnostic, text: "secret", url: "https://example.test" }), diagnostic);
	for (const field of Object.keys(diagnostic)) {
		assert.equal(sanitizeXPostDiagnostic({ ...diagnostic, [field]: "secret" }), undefined);
		const incomplete = { ...diagnostic };
		delete incomplete[field];
		assert.equal(sanitizeXPostDiagnostic(incomplete), undefined);
	}
	for (const invalid of [null, undefined, [], "secret"]) assert.equal(sanitizeXPostDiagnostic(invalid), undefined);
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
