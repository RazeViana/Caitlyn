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
import { trackMessage } from "../core/activityTracker.js";
import { caitlynAI } from "../messages/caitlynAI.js";
import { socialMediaMessage } from "../messages/socialMediaMessage.js";

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
		await dependencies.trackMessage(
			message.guild.id,
			message.author.id,
			message.author.username,
		);
	}

	// Start AI and social-media processing in their observed order
	const aiOperation = dependencies.caitlynAI(message);
	const socialOperation = dependencies.socialMediaMessage(message);
	await Promise.all([aiOperation, socialOperation]);
}

export { messageHandler };
