/**
 * @file conversationStore.js
 * @description This module manages in-memory storage for conversations, allowing messages to be added, retrieved, and reset per conversation key.
 * It is designed to support chat-based applications by maintaining a history of messages for each conversation.
 * The module ensures that only the most recent 40 messages are kept per conversation to help manage memory usage and token limits.
 *
 * @module conversationStore
 */

const conversationMap = new Map();

CONVERSATION_MEMORY_SIZE = process.env.CONVERSATION_MEMORY_SIZE;

function getConversation(key) {
	if (!conversationMap.has(key)) {
		conversationMap.set(key, []);
	}
	return conversationMap.get(key);
}

function addMessage(key, role, content) {
	const convo = getConversation(key);
	convo.push({ role, content });

	if (convo.length > CONVERSATION_MEMORY_SIZE) {
		convo.splice(0, convo.length - CONVERSATION_MEMORY_SIZE); // remove oldest
	}
}

function resetConversation(key) {
	conversationMap.delete(key);
}

module.exports = { getConversation, addMessage, resetConversation };
