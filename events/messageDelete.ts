/**
 * @file messageDelete.ts
 * @description Cancels queued previews and schedules removal of Caitlyn replies when sources disappear.
 * Persisted replacement-cleanup markers distinguish Caitlyn's own source deletion from user cancellation.
 *
 * @module messageDelete
 */

import { Events, type Message, type PartialMessage } from "discord.js";
import { socialRuntimes } from "../core/socialRuntime.js";

export const name = Events.MessageDelete;
export async function execute(message: Message | PartialMessage): Promise<void> {
	if (message.guildId) await socialRuntimes.get(message.client)?.cancel(message.guildId, message.channelId, message.id);
}
