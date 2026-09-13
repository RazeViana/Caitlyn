/**
 * @file messageUpdate.ts
 * @description Cancels stale social previews after edits while ignoring native embed-only updates.
 * Changed source content is not automatically reposted.
 *
 * @module messageUpdate
 */

import { Events, MessageFlags, type Message, type PartialMessage } from "discord.js";
import { socialRuntimes } from "../core/socialRuntime.js";

export const name = Events.MessageUpdate;
export async function execute(before: Message | PartialMessage, after: Message | PartialMessage): Promise<void> {
	if (!after.guildId || after.author?.bot) return;
	if (before.content !== after.content || before.editedTimestamp !== after.editedTimestamp || after.flags.has(MessageFlags.SuppressEmbeds)) {
		await socialRuntimes.get(after.client)?.cancel(after.guildId, after.channelId, after.id);
	}
}
