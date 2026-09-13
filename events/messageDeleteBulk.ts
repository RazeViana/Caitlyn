/**
 * @file messageDeleteBulk.ts
 * @description Cancels social previews affected by Discord's bounded bulk-delete batches.
 * Reuses single-message cancellation and its contained database failure behavior.
 *
 * @module messageDeleteBulk
 */

import { Events, type Collection, type Message, type PartialMessage } from "discord.js";
import { execute as cancel } from "./messageDelete.js";

export const name = Events.MessageBulkDelete;
export async function execute(messages: Collection<string, Message | PartialMessage>): Promise<void> {
	for (const message of messages.values()) await cancel(message);
}
