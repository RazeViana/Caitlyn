import assert from "node:assert/strict";
import { test } from "node:test";

const { socialMediaMessage } = await import("../messages/socialMediaMessage.ts");

function createMessage(content) {
	const sentMessages = [];
	let deleteCount = 0;
	return {
		message: {
			channel: {
				send: async (sentMessage) => {
					sentMessages.push(sentMessage);
				},
			},
			content,
			delete: async () => {
				deleteCount += 1;
			},
		},
		readEffects: () => ({ deleteCount, sentMessages }),
	};
}

test("supported social URLs are replaced and unsupported messages remain untouched", async () => {
	const cases = [
		["https://instagram.com/reel/abc", "[instagram.com](https://instagramez.com/reel/abc)"],
		["https://www.reddit.com/r/test/abc", "[reddit.com](https://www.redditez.com/r/test/abc)"],
		["https://tiktok.com/@alice/video/1", "[tiktok.com](https://tiktokez.com/@alice/video/1)"],
		["https://twitter.com/alice/status/1", "[twitter.com](https://twitterez.com/alice/status/1)"],
		["https://x.com/alice/status/1", "[x.com](https://twitterez.com/alice/status/1)"],
	];

	for (const [content, expectedMessage] of cases) {
		const { message, readEffects } = createMessage(content);
		await socialMediaMessage(message);
		assert.deepEqual(readEffects(), {
			deleteCount: 1,
			sentMessages: [expectedMessage],
		});
	}

	for (const content of [
		"https://youtube.com/watch?v=abc",
		"Have a look https://x.com/alice/status/1",
	]) {
		const { message, readEffects } = createMessage(content);
		await socialMediaMessage(message);
		assert.deepEqual(readEffects(), { deleteCount: 0, sentMessages: [] });
	}
});
