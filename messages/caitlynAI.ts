/**
 * @file caitlynAI.ts
 * @description This module provides the main AI handler for Caitlyn, managing conversation state and interaction with the chat model.
 * It retrieves and updates conversation history, formats user messages, injects a system prompt when needed, and sends/receives messages via the chat API.
 *
 * @module caitlynAI
 */

import type { Message } from "discord.js";
import { addMessage, getConversation } from "../core/conversationStore.js";
import { chat } from "../core/ollama.js";
import "dotenv/config";

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT;

async function caitlynAI(message: Message<true>): Promise<void> {
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
		await message.channel.send(reply);
	}
}

export { caitlynAI };
