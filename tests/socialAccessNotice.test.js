/**
 * @file socialAccessNotice.test.js
 * @description Tests honest, attributed Instagram access cards without confusing transient failures with private posts.
 *
 * @module socialAccessNotice.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderInstagramAccessNotice } from "../core/socialAccessNotice.ts";

const url = "https://www.instagram.com/p/DdUCjIygdfq/";

test("Instagram private/login cards contain compact source and sender attribution without raw errors", () => {
	for (const instagramReason of ["private_post", "login_required", "http_401"]) {
		const result = renderInstagramAccessNotice(url, "123", { provider: "instagram", outcome: "restricted", instagramReason });
		assert.equal(result.embeds[0].color, 0xe1306c);
		assert.match(result.embeds[0].title, /🔒/);
		assert.match(result.embeds[0].description, /Shared by <@123>/);
		assert.ok(result.embeds[0].description.includes(`[Open on Instagram ↗](${url})`));
		assert.equal(result.files, undefined);
		assert.equal(result.content, undefined);
		assert.deepEqual(result.allowedMentions, { parse: [], repliedUser: false });
	}
});

test("missing data, generic redirects/403, challenges, rate limits and timeouts are not called private", () => {
	for (const instagramReason of [undefined, "page_metadata_missing", "http_403", "http_redirect", "page_restricted", "query_failed", "http_429", "private secret"]) {
		assert.equal(renderInstagramAccessNotice(url, "123", { provider: "instagram", outcome: "restricted", instagramReason }), undefined);
	}
	for (const changes of [{ outcome: "timeout" }, { outcome: "unavailable" }, { provider: "tiktok" }]) {
		assert.equal(renderInstagramAccessNotice(url, "123", { provider: "instagram", outcome: "restricted", instagramReason: "private_post", ...changes }), undefined);
	}
	for (const invalid of ["https://evil.test/p/abc", `${url}?secret=1`, "https://www.instagram.com/share/p/abc/", "https://www.instagram.com/accounts/login/"]) {
		assert.equal(renderInstagramAccessNotice(invalid, "123", { provider: "instagram", outcome: "restricted", instagramReason: "private_post" }), undefined);
	}
	assert.equal(renderInstagramAccessNotice(url, "@everyone", { provider: "instagram", outcome: "restricted", instagramReason: "private_post" }), undefined);
});
