/**
 * @file messageHandler.ts
 * @description Filters bot messages, tracks guild activity, and routes AI and social-message work.
 * Contains activity failures and awaits independently settled message processors.
 *
 * @module messageHandler
 */

import type { Message } from "discord.js";
import { trackMessage } from "../core/activityTracker.js";
import { caitlynAI } from "../messages/caitlynAI.js";
import { socialMediaMessage } from "../messages/socialMediaMessage.js";
import logger from "../core/logger.js";

export interface MessageHandlerDependencies {
	caitlynAI: (message: Message) => Promise<void>;
	socialMediaMessage: (message: Message) => Promise<void>;
	trackMessage: (
		guildId: string,
		userId: string,
		username: string,
	) => Promise<void>;
}

const defaultMessageHandlerDependencies: MessageHandlerDependencies = {
	caitlynAI,
	socialMediaMessage,
	trackMessage,
};

async function messageHandler(
	message: Message,
	dependencies: MessageHandlerDependencies = defaultMessageHandlerDependencies,
): Promise<void> {
	// Track message for activity statistics
	if (message.guild) {
		try {
			await dependencies.trackMessage(message.guild.id, message.author.id, message.author.username);
		}
		catch (error) {
			logger.error("Could not track message activity:", error);
		}
	}

	// Start AI and social-media processing in their observed order
	const aiOperation = dependencies.caitlynAI(message);
	const socialOperation = dependencies.socialMediaMessage(message);
	const outcomes = await Promise.allSettled([aiOperation, socialOperation]);
	for (const outcome of outcomes) {
		if (outcome.status === "rejected") logger.error("Message processing failed:", outcome.reason);
	}
}

export { messageHandler };
