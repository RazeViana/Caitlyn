/**
 * @file caitlynAI.test.js
 * @description Tests disabled AI, conversation context, reply delivery, and memory storage.
 * Uses deterministic service substitutes for successful replies and error fallbacks.
 *
 * @module caitlynAI.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const originalContextRecentCount = process.env.CONTEXT_RECENT_COUNT;
const originalContextSimilarCount = process.env.CONTEXT_SIMILAR_COUNT;
let caitlynAI;

try {
	process.env.CONTEXT_RECENT_COUNT = "4";
	process.env.CONTEXT_SIMILAR_COUNT = "2";
	({ caitlynAI } = await import("../messages/caitlynAI.ts"));
}
finally {
	restoreEnvironmentVariable("CONTEXT_RECENT_COUNT", originalContextRecentCount);
	restoreEnvironmentVariable("CONTEXT_SIMILAR_COUNT", originalContextSimilarCount);
}

function restoreEnvironmentVariable(name, value) {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

function createMessage(sentMessages) {
	return {
		author: {
			id: "user-id",
			username: "Alice",
		},
		channel: {
			id: "channel-id",
			send: async (content) => {
				sentMessages.push(content);
			},
		},
		client: {
			user: {
				id: "bot-id",
			},
		},
		content: "Where did we leave off?",
		id: "message-id",
	};
}

function createLogger() {
	return {
		debug: () => undefined,
		error: () => undefined,
	};
}

test("AI-disabled messages skip context, chat, storage, and replies", async () => {
	const calls = [];
	const sentMessages = [];

	await caitlynAI(createMessage(sentMessages), {
		chat: async () => {
			calls.push("chat");
			return "Unexpected reply";
		},
		getConversationContext: async () => {
			calls.push("context");
			return [];
		},
		isAIEnabled: () => false,
		logger: createLogger(),
		storeMessage: async () => {
			calls.push("storage");
			return 1;
		},
	});

	assert.deepEqual(calls, []);
	assert.deepEqual(sentMessages, []);
});

test("AI works without configured memory and never calls its database or embedding path", async () => {
	const sent = [];
	await caitlynAI(createMessage(sent), {
		isAIEnabled: () => true, memoryEnabled: () => false, logger: createLogger(),
		getConversationContext: async () => assert.fail("unconfigured memory was read"),
		storeMessage: async () => assert.fail("unconfigured memory was written"),
		chat: async (messages) => {
			assert.equal(messages.length, 1);
			return "Here is your reply without memory.";
		},
	});
	assert.deepEqual(sent, [{ content: "Here is your reply without memory.", allowedMentions: { parse: [] } }]);
});

test("AI context uses numeric defaults when optional counts are absent", async () => {
	const previousRecentCount = process.env.CONTEXT_RECENT_COUNT;
	const previousSimilarCount = process.env.CONTEXT_SIMILAR_COUNT;
	try {
		delete process.env.CONTEXT_RECENT_COUNT;
		delete process.env.CONTEXT_SIMILAR_COUNT;
		const { caitlynAI: defaultAI } = await import("../messages/caitlynAI.ts?default-context-counts");
		const contextQueries = [];
		await defaultAI(createMessage([]), {
			chat: async () => undefined,
			getConversationContext: async (query) => {
				contextQueries.push(query);
				return [];
			},
			isAIEnabled: () => true,
			logger: createLogger(),
			storeMessage: async () => 1,
		});
		assert.deepEqual(contextQueries, [{
			channelId: "channel-id",
			currentMessage: "Where did we leave off?",
			recentCount: 5,
			similarCount: 3,
		}]);
	}
	finally {
		restoreEnvironmentVariable("CONTEXT_RECENT_COUNT", previousRecentCount);
		restoreEnvironmentVariable("CONTEXT_SIMILAR_COUNT", previousSimilarCount);
	}
});

test("AI replies use vector context and store both user and assistant messages", async () => {
	const contextQueries = [];
	const chatRequests = [];
	const storedMessages = [];
	const sentMessages = [];
	const message = createMessage(sentMessages);

	await caitlynAI(message, {
		chat: async (messages, chatId) => {
			chatRequests.push({ chatId, messages });
			return "Here is the answer.";
		},
		getConversationContext: async (query) => {
			contextQueries.push(query);
			return [
				{
					content: "Earlier question",
					created_at: new Date("2026-09-03T10:00:00.000Z"),
					id: 10,
					role: "user",
					source: "recent",
					username: "Bob",
				},
				{
					content: "Earlier answer",
					created_at: new Date("2026-09-03T10:01:00.000Z"),
					id: 11,
					role: "assistant",
					source: "similar",
					username: "Caitlyn",
				},
			];
		},
		isAIEnabled: () => true,
		logger: createLogger(),
		storeMessage: async (storedMessage) => {
			storedMessages.push(storedMessage);
			return storedMessages.length;
		},
	});

	assert.deepEqual(contextQueries, [{
		channelId: "channel-id",
		currentMessage: "Where did we leave off?",
		recentCount: 4,
		similarCount: 2,
	}]);
	assert.deepEqual(chatRequests, [{
		chatId: "discord-channel-id",
		messages: [
			{ role: "user", content: "Bob: Earlier question" },
			{ role: "assistant", content: "Caitlyn: Earlier answer" },
			{ role: "user", content: "Alice: Where did we leave off?" },
		],
	}]);
	assert.deepEqual(sentMessages, [{ content: "Here is the answer.", allowedMentions: { parse: [] } }]);
	assert.deepEqual(storedMessages, [
		{
			channelId: "channel-id",
			content: "Where did we leave off?",
			messageId: "message-id",
			role: "user",
			userId: "user-id",
			username: "Alice",
		},
		{
			channelId: "channel-id",
			content: "Here is the answer.",
			messageId: "message-id-reply",
			role: "assistant",
			userId: "bot-id",
			username: "Caitlyn",
		},
	]);
});

test("AI errors send the existing user-facing fallback", async () => {
	const sentMessages = [];
	const loggedErrors = [];
	const failure = new Error("chat unavailable");

	await caitlynAI(createMessage(sentMessages), {
		chat: async () => { throw failure; },
		getConversationContext: async () => [],
		isAIEnabled: () => true,
		logger: {
			debug: () => undefined,
			error: (...args) => {
				loggedErrors.push(args);
			},
		},
		storeMessage: async () => 1,
	});

	assert.deepEqual(sentMessages, [
		"Sorry, I encountered an error processing your message. Please try again.",
	]);
	assert.equal(loggedErrors.length, 1);
	assert.equal(loggedErrors[0][0], "Could not finish the AI reply");
	assert.match(loggedErrors[0][1], /channel: "channel-id".*user: "user-id".*message: "message-id"/);
	assert.ok(!loggedErrors.flat().includes(failure));
});
