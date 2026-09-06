/**
 * @file caitlynAI.ts
 * @description Coordinates AI replies with PostgreSQL-backed recent and semantic conversation memory.
 * Bounds concurrent work and output, tolerates memory outages, and contains reply failures.
 * The system prompt is configured in Open WebUI model settings.
 *
 * @module caitlynAI
 */

import type { Message, SendableChannels } from "discord.js";
import { isAIEnabled } from "../core/aiState.js";
import logger from "../core/logger.js";
import { getConversationContext, storeMessage } from "../core/messageStore.js";
import { chat } from "../core/ollama.js";
import { messageChunks } from "../core/textLimits.js";
import type { ContextQuery, StoreMessageInput } from "../core/messageStore.js";
import type { ChatMessage, MessageContext } from "../types/models.js";

const CONTEXT_RECENT_COUNT = Number(process.env.CONTEXT_RECENT_COUNT ?? "5");
const CONTEXT_SIMILAR_COUNT = Number(process.env.CONTEXT_SIMILAR_COUNT ?? "3");

interface CaitlynAILogger {
	debug: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

export interface CaitlynAIDependencies {
	chat: (messages: ChatMessage[], chatId: string | null) => Promise<string | undefined>;
	getConversationContext: (query: ContextQuery) => Promise<MessageContext[]>;
	isAIEnabled: () => boolean;
	logger: CaitlynAILogger;
	storeMessage: (message: StoreMessageInput) => Promise<number>;
}

const defaultCaitlynAIDependencies: CaitlynAIDependencies = {
	chat,
	getConversationContext,
	isAIEnabled,
	logger,
	storeMessage,
};

const activeChannels = new Set<string>();

async function caitlynAI(
	message: Message,
	dependencies: CaitlynAIDependencies = defaultCaitlynAIDependencies,
): Promise<void> {
	if (!dependencies.isAIEnabled() || !message.content.trim()) return;
	const channel = message.channel as SendableChannels;
	if (activeChannels.has(channel.id) || activeChannels.size >= 4) {
		dependencies.logger.debug("Skipping AI message while capacity is exhausted");
		return;
	}
	activeChannels.add(channel.id);
	let replyAttempted = false;
	try {
		let context: MessageContext[] = [];
		try {
			context = await dependencies.getConversationContext({
				channelId: channel.id,
				currentMessage: message.content,
				recentCount: CONTEXT_RECENT_COUNT,
				similarCount: CONTEXT_SIMILAR_COUNT,
			});
		}
		catch (error) {
			dependencies.logger.error("AI memory unavailable; continuing without stored context:", error);
		}
		const messages: ChatMessage[] = context.map((entry) => ({
			role: entry.role,
			content: `${entry.username}: ${entry.content}`,
		}));
		messages.push({ role: "user", content: `${message.author.username}: ${message.content}` });
		const reply = await dependencies.chat(messages, `discord-${channel.id}`);
		if (!reply?.trim()) throw new Error("AI returned an empty reply");
		const chunks = messageChunks(reply);
		for (const content of chunks) {
			replyAttempted = true;
			await channel.send({ content, allowedMentions: { parse: [] } });
		}
		try {
			await dependencies.storeMessage({
				channelId: channel.id, messageId: message.id, userId: message.author.id,
				username: message.author.username, role: "user", content: message.content,
			});
			await dependencies.storeMessage({
				channelId: channel.id, messageId: `${message.id}-reply`, userId: message.client.user.id,
				username: "Caitlyn", role: "assistant", content: chunks.join(""),
			});
		}
		catch (error) {
			dependencies.logger.error("Reply delivered but AI memory could not be saved:", error);
		}
	}
	catch (error) {
		dependencies.logger.error("Error processing AI message:", error);
		if (!replyAttempted) {
			try {
				await channel.send("Sorry, I encountered an error processing your message. Please try again.");
			}
			catch (sendError) {
				dependencies.logger.error("Could not send AI error response:", sendError);
			}
		}
	}
	finally {
		activeChannels.delete(channel.id);
	}
}

export { caitlynAI };
