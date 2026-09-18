/**
 * @file messageDelete.ts
 * @description Cancels queued previews and schedules removal of Caitlyn replies when sources disappear.
 * Persisted replacement-cleanup markers distinguish Caitlyn's own source deletion from user cancellation.
 *
 * @module messageDelete
 */

import { Events, type Message, type PartialMessage } from "discord.js";
import { socialRuntimes } from "../core/socialRuntime.js";
import { logData } from "../core/dataLog.js";

export const name = Events.MessageDelete;
export async function execute(message: Message | PartialMessage): Promise<void> {
	if (message.guildId) {
		// Do not log this bot's log-channel messages: their deletion must not produce another log message.
		if (!message.author?.bot && message.author?.id !== message.client.user?.id) {
			logData("Received a message deletion; checking for a linked social preview", {
				server: message.guildId, channel: message.channelId, user: message.author?.id, message: message.id,
			});
		}
		await socialRuntimes.get(message.client)?.cancel(message.guildId, message.channelId, message.id);
	}
}
