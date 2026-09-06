/**
 * @file messageCreate.ts
 * @description Awaits message routing for incoming Discord messages.
 * Logs processing failures so rejected message work does not escape the event boundary.
 *
 * @module messageCreate
 */
import { Events, type Message } from "discord.js";
import { messageHandler } from "../handlers/messageHandler.js";
import logger from "../core/logger.js";

export const name = Events.MessageCreate;
export async function execute(message: Message, handle = messageHandler): Promise<void> {
	// Ignore bot messages
	if (message.author.bot) return;

	// Message handler for processing incoming messages
	try {
		await handle(message);
	}
	catch (error) {
		logger.error("Error handling message:", error);
	}
}
