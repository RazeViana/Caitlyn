/**
 * @file socialEmbed.test.js
 * @description Checks native-preview URL routing, configuration, and Discord send recovery without live messages.
 * Ensures previews carry usernames and retain identity without an attachment upload.
 *
 * @module socialEmbed.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { socialEmbedOrigin, socialEmbedShareMatches, socialEmbedUrl } from "../core/socialEmbed.ts";
import { getFeatureConfiguration } from "../core/environment.ts";

const origin = "https://embed.example.com";

test("share URLs carry validated usernames and isolate the Discord preview cache between sharers", () => {
	const source = "https://x.com/alice/status/123";
	const first = socialEmbedUrl(source, origin, "real.user");
	assert.equal(first, origin + "/alice/status/123?shared_by=real.user&v=4");
	assert.notEqual(first, socialEmbedUrl(source, origin, "another_user"));
	assert.equal(socialEmbedShareMatches(first, source, origin), true);
	assert.equal(socialEmbedShareMatches(origin + "/alice/status/123?shared_by=real.user", source, origin), true);
	assert.equal(socialEmbedShareMatches(origin + "/alice/status/123?shared_by=real.user&v=2", source, origin), true);
	assert.equal(socialEmbedShareMatches(origin + "/alice/status/123?shared_by=real.user&v=3", source, origin), true);
	for (const value of [first + "&shared_by=other", first + "&extra=1", first + "#fragment", first.replace("v=4", "v=5"), first + "&v=4", first.replace("example.com", "evil.example.com"), first.replace("123?", "456?")]) {
		assert.equal(socialEmbedShareMatches(value, source, origin), false);
	}
	for (const username of ["", "a", "a".repeat(33), "Nickname with spaces", "<@123>", "name\nother", "name\u202e"]) {
		assert.throws(() => socialEmbedUrl(source, origin, username));
	}
});

test("one-domain previews preserve platform paths and normalize share links without fetching", () => {
	for (const [source, path] of [
		["https://x.com/alice/status/123?s=20", "/alice/status/123"],
		["https://mobile.twitter.com/alice/status/123/video/1", "/alice/status/123"],
		["https://www.instagram.com/user/reel/AbC_123/?igsh=tracking", "/reel/AbC_123/"],
		["https://www.tiktok.com/@creator/video/123", "/@creator/video/123"],
		["https://vm.tiktok.com/ZMexample/", "/t/ZMexample"],
		["https://vt.tiktok.com/ZMexample/?q=tracking", "/t/ZMexample"],
	]) assert.equal(socialEmbedUrl(source, origin), origin + path);
	for (const input of ["https://x.com.evil.com/alice/status/123", "http://127.0.0.1/", "https://instagram.com/share/p/test", "https://www.reddit.com/comments/123/"]) {
		assert.throws(() => socialEmbedUrl(input, origin));
	}
});

test("embed configuration requires a public HTTPS origin and does not depend on the media worker", () => {
	assert.equal(socialEmbedOrigin(origin + "/"), origin);
	for (const input of [undefined, "", "http://embed.example.com", "https://user:pass@embed.example.com", origin + "/path", origin + "?q=1", "https://127.0.0.1", "https://foo.local", "https://embed.example.com:8787"]) {
		assert.throws(() => socialEmbedOrigin(input));
	}
	const env = { PGHOST: "localhost", PGPORT: "5432", PGUSER: "test", PGPASSWORD: "test", PGDATABASE: "test", SOCIAL_MEDIA_ENABLED: "true",
		SOCIAL_DELIVERY_MODE: "embed", SOCIAL_EMBED_ORIGIN: origin };
	assert.equal(getFeatureConfiguration(env).socialMedia.enabled, true);
	assert.equal(getFeatureConfiguration({ ...env, SOCIAL_EMBED_ORIGIN: "http://private" }).socialMedia.enabled, false);
	assert.equal(getFeatureConfiguration({ ...env, SOCIAL_DELIVERY_MODE: "unknown" }).socialMedia.enabled, false);
	assert.equal(getFeatureConfiguration({ ...env, SOCIAL_DELIVERY_MODE: "attachments" }).socialMedia.enabled, false);
});
