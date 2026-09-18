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
import { getFeatureConfiguration } from "../core/environment.js";
import { logData } from "../core/dataLog.js";

export interface MessageHandlerDependencies {
	caitlynAI: (message: Message) => Promise<void>;
	socialMediaMessage: (message: Message) => Promise<void>;
	trackMessage: (
		guildId: string,
		userId: string,
		username: string,
		source?: { channelId: string; messageId: string },
	) => Promise<void>;
}

const defaultMessageHandlerDependencies: MessageHandlerDependencies = {
	caitlynAI,
	socialMediaMessage,
	trackMessage: async (guildId, userId, username, source) => {
		if (getFeatureConfiguration().database.enabled) {
			await trackMessage(guildId, userId, username, undefined, source);
		}
		else {
			logData("Message activity not saved; database feature is turned off", {
				server: guildId, user: userId, channel: source?.channelId, message: source?.messageId,
			});
		}
	},
};

async function messageHandler(
	message: Message,
	dependencies: MessageHandlerDependencies = defaultMessageHandlerDependencies,
): Promise<void> {
	// Activity storage must not delay independent AI or media admission.
	const activityOperation = (async () => {
		if (!message.guild) {
			logData("Message activity not saved; this is not a server message", { channel: message.channelId, message: message.id, user: message.author.id });
			return;
		}
		try {
			await dependencies.trackMessage(message.guild.id, message.author.id, message.author.username, { channelId: message.channelId, messageId: message.id });
		}
		catch (error) {
			logger.error("Could not track message activity:", error);
		}
	})();

	// Start AI and social-media processing in their observed order
	const aiOperation = dependencies.caitlynAI(message);
	const socialOperation = dependencies.socialMediaMessage(message);
	const outcomes = await Promise.allSettled([activityOperation, aiOperation, socialOperation]);
	for (const outcome of outcomes) {
		if (outcome.status === "rejected") logger.error("Message processing failed:", outcome.reason);
	}
}

export { messageHandler };
