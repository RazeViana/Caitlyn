/**
 * @file socialMediaMessage.ts
 * @description Enqueues opt-in X previews without downloading media inside a message event.
 * Leaves originals and unsupported platforms untouched; never uses hosted-fixer fallbacks.
 *
 * @module socialMediaMessage
 */

import type { Message } from "discord.js";
import { socialRuntimes } from "../core/socialRuntime.js";

export async function socialMediaMessage(message: Message): Promise<void> {
	await socialRuntimes.get(message.client)?.enqueue(message);
}
