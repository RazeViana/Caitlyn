/**
 * @file caitlynAI.js
 * @description This module provides the main AI handler for Caitlyn, managing conversation state and interaction with the chat model.
 * It retrieves and updates conversation history, formats user messages, injects a system prompt when needed, and sends/receives messages via the chat API.
 *
 * @module caitlynAI
 */

const { getConversation, addMessage } = require("../core/conversationStore");
const { chat } = require("../core/ollama.js");

require("dotenv").config();

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;

async function caitlynAI(message) {
	const key = message.channel.id;
	const messages = getConversation(key);
	const userMessageFormat = message.author.username + ": " + message.content;

	// check if the messages array is empty otherwise add the system prompt
	if (messages.length === 0) {
		messages.push({ role: "system", content: SYSTEM_PROMPT });
	}

	// Add the user message to the conversation
	messages.push({
		role: "user",
		content: userMessageFormat,
	});

	const reply = await chat(messages);

	if (reply.trim() !== "NOTHING") {
		addMessage(key, "assistant", reply);
		message.channel.send(reply);
	}
}

module.exports = { caitlynAI };
