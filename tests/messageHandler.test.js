/**
 * @file messageHandler.test.js
 * @description Tests activity tracking and overlapping AI/social message processing.
 * Uses controlled promises to verify ordering and completion in either settlement order.
 *
 * @module messageHandler.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const { messageHandler } = await import("../handlers/messageHandler.ts");

function deferred() {
	let resolve;
	const promise = new Promise((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

function flushOperations() {
	return new Promise((resolve) => setImmediate(resolve));
}

function createMessage(guild = { id: "guild-id" }) {
	return {
		author: {
			id: "user-id",
			username: "Alice",
		},
		guild,
	};
}

test("message handling tracks guild activity before starting overlapping AI and social work", async () => {
	const calls = [];
	const trackGate = deferred();
	const aiGate = deferred();
	const socialGate = deferred();
	const operation = messageHandler(createMessage(), {
		caitlynAI: () => {
			calls.push("ai");
			return aiGate.promise;
		},
		socialMediaMessage: () => {
			calls.push("social");
			return socialGate.promise;
		},
		trackMessage: (guildId, userId, username) => {
			calls.push({ guildId, userId, username });
			return trackGate.promise;
		},
	});

	assert.deepEqual(calls, [{
		guildId: "guild-id",
		userId: "user-id",
		username: "Alice",
	}]);

	trackGate.resolve();
	await flushOperations();
	assert.deepEqual(calls, [
		{ guildId: "guild-id", userId: "user-id", username: "Alice" },
		"ai",
		"social",
	]);

	aiGate.resolve();
	socialGate.resolve();
	await operation;
});

test("message handling awaits both AI and social operations in either settlement order", async () => {
	for (const firstToResolve of ["ai", "social"]) {
		const calls = [];
		const aiGate = deferred();
		const socialGate = deferred();
		const operation = messageHandler(createMessage(null), {
			caitlynAI: () => {
				calls.push("ai");
				return aiGate.promise;
			},
			socialMediaMessage: () => {
				calls.push("social");
				return socialGate.promise;
			},
			trackMessage: async () => undefined,
		});
		let completed = false;
		const observedOperation = operation.then(() => {
			completed = true;
		});

		assert.deepEqual(calls, ["ai", "social"]);
		if (firstToResolve === "ai") {
			aiGate.resolve();
		}
		else {
			socialGate.resolve();
		}
		await flushOperations();
		assert.equal(completed, false, `${firstToResolve} must not finish the handler alone`);

		if (firstToResolve === "ai") {
			socialGate.resolve();
		}
		else {
			aiGate.resolve();
		}
		await observedOperation;
		assert.equal(completed, true);
	}
});
