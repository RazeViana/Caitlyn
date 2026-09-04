import assert from "node:assert/strict";
import { test } from "node:test";

process.env.CONTEXT_RECENT_COUNT = "4";
process.env.CONTEXT_SIMILAR_COUNT = "2";

const { caitlynAI } = await import("../messages/caitlynAI.ts");

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
	assert.deepEqual(sentMessages, ["Here is the answer."]);
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

	await caitlynAI(createMessage(sentMessages), {
		chat: async () => "Unexpected reply",
		getConversationContext: async () => {
			throw new Error("context unavailable");
		},
		isAIEnabled: () => true,
		logger: createLogger(),
		storeMessage: async () => 1,
	});

	assert.deepEqual(sentMessages, [
		"Sorry, I encountered an error processing your message. Please try again.",
	]);
});
