/**
 * @file messageHandler.ts
 * @description This module handles incoming messages for a Discord.js bot.
 * It processes messages to filter out bot messages and empty content,
 * and utilizes message functions to handle specific message content.
 *
 * The primary function ensures that only valid user messages are processed
 * and delegates further processing to the message functions.
 *
 * @module messageHandler
 */

import type { Message } from "discord.js";
import { caitlynAI } from "../messages/caitlynAI.js";
import { socialMediaMessage } from "../messages/socialMediaMessage.js";
import "dotenv/config";

const LLM_ENABLED = process.env.LLM_ENABLED;

async function messageHandler(message: Message<true>): Promise<void> {
	// Check if the message is from a bot or if it doesn't contain any content
	if (message.author.bot || !message.content) return;

	// LLM message handling
	if (LLM_ENABLED === "true") {
		const aiOperation = caitlynAI(message);
		const socialOperation = socialMediaMessage(message);

		await Promise.all([aiOperation, socialOperation]);
		return;
	}

	// Social media message handling for embedding
	await socialMediaMessage(message);
}

export { messageHandler };
