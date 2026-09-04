const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

process.env.CONVERSATION_MEMORY_SIZE = "2";

const {
	addMessage,
	getConversation,
	resetConversation,
} = require("../core/conversationStore.js");

const keys = [];

afterEach(() => {
	for (const key of keys.splice(0)) {
		resetConversation(key);
	}
});

test("creates an empty conversation for a new key", () => {
	const key = "new-conversation";
	keys.push(key);

	assert.deepEqual(getConversation(key), []);
});

test("keeps only the configured number of recent messages", () => {
	const key = "bounded-conversation";
	keys.push(key);

	addMessage(key, "user", "first");
	addMessage(key, "assistant", "second");
	addMessage(key, "user", "third");

	assert.deepEqual(getConversation(key), [
		{ role: "assistant", content: "second" },
		{ role: "user", content: "third" },
	]);
});
