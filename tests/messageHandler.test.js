const assert = require("node:assert/strict");
const { after, test } = require("node:test");

process.env.LLM_ENABLED = "true";

const aiPath = require.resolve("../messages/caitlynAI.ts");
const socialPath = require.resolve("../messages/socialMediaMessage.ts");
const handlerPath = require.resolve("../handlers/messageHandler.ts");
const previousAI = require.cache[aiPath];
const previousSocial = require.cache[socialPath];
const previousHandler = require.cache[handlerPath];
const starts = [];
let resolveAI;
let resolveSocial;

require.cache[aiPath] = {
	id: aiPath,
	filename: aiPath,
	loaded: true,
	exports: {
		caitlynAI() {
			starts.push("ai");
			return new Promise((resolve) => {
				resolveAI = resolve;
			});
		},
	},
};
require.cache[socialPath] = {
	id: socialPath,
	filename: socialPath,
	loaded: true,
	exports: {
		socialMediaMessage() {
			starts.push("social");
			return new Promise((resolve) => {
				resolveSocial = resolve;
			});
		},
	},
};
delete require.cache[handlerPath];

const { messageHandler } = require(handlerPath);

after(() => {
	for (const [modulePath, previous] of [
		[aiPath, previousAI],
		[socialPath, previousSocial],
		[handlerPath, previousHandler],
	]) {
		if (previous) {
			require.cache[modulePath] = previous;
		}
		else {
			delete require.cache[modulePath];
		}
	}
});

test("message handling starts AI then social work concurrently and awaits both", async () => {
	let settled = false;
	const operation = messageHandler({
		author: { bot: false },
		content: "https://x.com/example/status/123",
	}).then(() => {
		settled = true;
	});

	assert.deepEqual(starts, ["ai", "social"]);

	resolveSocial();
	await Promise.resolve();
	assert.equal(settled, false);

	resolveAI();
	await operation;
	assert.equal(settled, true);
});
