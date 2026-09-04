const assert = require("node:assert/strict");
const { after, test } = require("node:test");

process.env.CONVERSATION_MEMORY_SIZE = "10";
process.env.SYSTEM_PROMPT = "You are Caitlyn in a hermetic test.";

const ollamaPath = require.resolve("../core/ollama.ts");
const caitlynAIPath = require.resolve("../messages/caitlynAI.ts");
const previousOllama = require.cache[ollamaPath];
const previousCaitlynAI = require.cache[caitlynAIPath];
let nextReply = "Hello from the test model";
const requests = [];

require.cache[ollamaPath] = {
	id: ollamaPath,
	filename: ollamaPath,
	loaded: true,
	exports: {
		async chat(messages) {
			requests.push(messages.map((message) => ({ ...message })));
			return nextReply;
		},
	},
};
delete require.cache[caitlynAIPath];

const { caitlynAI } = require(caitlynAIPath);
const {
	getConversation,
	resetConversation,
} = require("../core/conversationStore.ts");

after(() => {
	if (previousOllama) {
		require.cache[ollamaPath] = previousOllama;
	}
	else {
		delete require.cache[ollamaPath];
	}

	if (previousCaitlynAI) {
		require.cache[caitlynAIPath] = previousCaitlynAI;
	}
	else {
		delete require.cache[caitlynAIPath];
	}
});

test("caitlynAI orchestrates system, user, model, memory, and reply behavior", async () => {
	const key = "ai-reply-channel";
	const sent = [];

	try {
		await caitlynAI({
			author: { username: "Test User" },
			content: "Hello Caitlyn",
			channel: {
				id: key,
				async send(message) {
					sent.push(message);
				},
			},
		});

		assert.deepEqual(requests.at(-1), [
			{ role: "system", content: "You are Caitlyn in a hermetic test." },
			{ role: "user", content: "Test User: Hello Caitlyn" },
		]);
		assert.deepEqual(getConversation(key), [
			{ role: "system", content: "You are Caitlyn in a hermetic test." },
			{ role: "user", content: "Test User: Hello Caitlyn" },
			{ role: "assistant", content: "Hello from the test model" },
		]);
		assert.deepEqual(sent, ["Hello from the test model"]);
	}
	finally {
		resetConversation(key);
	}
});

test("caitlynAI keeps NOTHING replies out of memory and Discord", async () => {
	const key = "ai-nothing-channel";
	const sent = [];
	nextReply = "NOTHING";

	try {
		await caitlynAI({
			author: { username: "Quiet User" },
			content: "No response needed",
			channel: {
				id: key,
				async send(message) {
					sent.push(message);
				},
			},
		});

		assert.deepEqual(getConversation(key), [
			{ role: "system", content: "You are Caitlyn in a hermetic test." },
			{ role: "user", content: "Quiet User: No response needed" },
		]);
		assert.deepEqual(sent, []);
	}
	finally {
		resetConversation(key);
		nextReply = "Hello from the test model";
	}
});
