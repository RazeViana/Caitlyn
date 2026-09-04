import assert from "node:assert/strict";
import { test } from "node:test";

const { socialMediaMessage } = await import("../messages/socialMediaMessage.ts");

function createMessage(content, failures = {}) {
	const calls = [];
	return {
		message: {
			channel: {
				send: async (sentMessage) => {
					calls.push(["send", sentMessage]);
					if (failures.send) throw failures.send;
				},
			},
			content,
			delete: async () => {
				calls.push(["delete"]);
				if (failures.delete) throw failures.delete;
			},
		},
		readCalls: () => calls,
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
		const { message, readCalls } = createMessage(content);
		await socialMediaMessage(message);
		assert.deepEqual(readCalls(), [
			["delete"],
			["send", expectedMessage],
		]);
	}

	for (const content of [
		"https://youtube.com/watch?v=abc",
		"Have a look https://x.com/alice/status/1",
	]) {
		const { message, readCalls } = createMessage(content);
		await socialMediaMessage(message);
		assert.deepEqual(readCalls(), []);
	}
});

test("social URL replacement silently handles delete and send failures", async () => {
	const content = "https://x.com/alice/status/1";
	const expectedMessage = "[x.com](https://twitterez.com/alice/status/1)";
	const deleteFailure = createMessage(content, {
		delete: new Error("delete failed"),
	});

	await assert.doesNotReject(() => socialMediaMessage(deleteFailure.message));
	assert.deepEqual(deleteFailure.readCalls(), [["delete"]]);

	const sendFailure = createMessage(content, {
		send: new Error("send failed"),
	});
	await assert.doesNotReject(() => socialMediaMessage(sendFailure.message));
	assert.deepEqual(sendFailure.readCalls(), [
		["delete"],
		["send", expectedMessage],
	]);
});
