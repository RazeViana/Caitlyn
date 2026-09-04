const assert = require("node:assert/strict");
const { after, test } = require("node:test");

process.env.LLM_ENABLED = "true";

const aiPath = require.resolve("../messages/caitlynAI.ts");
const socialPath = require.resolve("../messages/socialMediaMessage.ts");
const handlerPath = require.resolve("../handlers/messageHandler.ts");
const previousAI = require.cache[aiPath];
const previousSocial = require.cache[socialPath];
const previousHandler = require.cache[handlerPath];
let activeOperations;

function createDeferred() {
	let resolve;
	const promise = new Promise((deferredResolve) => {
		resolve = deferredResolve;
	});

	return { promise, resolve };
}

function createOperations() {
	return {
		ai: createDeferred(),
		social: createDeferred(),
		starts: [],
	};
}

require.cache[aiPath] = {
	id: aiPath,
	filename: aiPath,
	loaded: true,
	exports: {
		caitlynAI() {
			activeOperations.starts.push("ai");
			return activeOperations.ai.promise;
		},
	},
};
require.cache[socialPath] = {
	id: socialPath,
	filename: socialPath,
	loaded: true,
	exports: {
		socialMediaMessage() {
			activeOperations.starts.push("social");
			return activeOperations.social.promise;
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

async function assertResolutionOrder(first, second) {
	activeOperations = createOperations();
	let settled = false;
	let operation;

	try {
		operation = messageHandler({
			author: { bot: false },
			content: "https://x.com/example/status/123",
		}).then(() => {
			settled = true;
		});

		assert.deepEqual(activeOperations.starts, ["ai", "social"]);

		activeOperations[first].resolve();
		await Promise.resolve();
		assert.equal(settled, false);

		activeOperations[second].resolve();
		await operation;
		assert.equal(settled, true);
	}
	finally {
		activeOperations.ai.resolve();
		activeOperations.social.resolve();
		if (operation) await operation;
	}
}

test("message handling remains pending for social work after AI settles", async () => {
	await assertResolutionOrder("ai", "social");
});

test("message handling remains pending for AI work after social settles", async () => {
	await assertResolutionOrder("social", "ai");
});
