/**
 * @file socialMediaMessage.test.js
 * @description Verifies the opt-in enqueue entry point never rewrites, suppresses, or deletes originals.
 * Uses synthetic runtimes without Discord or worker access.
 *
 * @module socialMediaMessage.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { socialMediaMessage } from "../messages/socialMediaMessage.ts";
import { socialRuntimes } from "../core/socialRuntime.ts";

test("social messages remain untouched when the runtime is disabled", async () => {
	for (const content of ["https://x.com/alice/status/123", "https://instagram.com/reel/abc", "https://www.reddit.com/r/test/comments/abc/title/", "ordinary text"]) {
		const message = { client: {}, content };
		await socialMediaMessage(message);
		assert.equal(message.content, content);
	}
});

test("enabled social handler delegates only to the queue", async () => {
	const message = { client: {}, content: "https://x.com/alice/status/123" };
	let received;
	socialRuntimes.set(message.client, { enqueue: async (input) => { received = input; } });
	await socialMediaMessage(message);
	assert.equal(received, message);
	socialRuntimes.delete(message.client);
});
