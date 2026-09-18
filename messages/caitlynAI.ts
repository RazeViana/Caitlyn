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
import { dataErrorReason, logData } from "../core/dataLog.js";
import { getConversationContext, storeMessage } from "../core/messageStore.js";
import { chat } from "../core/ollama.js";
import { messageChunks } from "../core/textLimits.js";
import type { ContextQuery, StoreMessageInput } from "../core/messageStore.js";
import type { ChatMessage, MessageContext } from "../types/models.js";
import { getFeatureConfiguration } from "../core/environment.js";

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
	memoryEnabled?: () => boolean;
	logger: CaitlynAILogger;
	storeMessage: (message: StoreMessageInput) => Promise<number>;
}

const defaultCaitlynAIDependencies: CaitlynAIDependencies = {
	chat,
	getConversationContext,
	memoryEnabled: () => getFeatureConfiguration().memory.enabled,
	isAIEnabled,
	logger,
	storeMessage,
};

const activeChannels = new Set<string>();

async function caitlynAI(
	message: Message,
	dependencies: CaitlynAIDependencies = defaultCaitlynAIDependencies,
): Promise<void> {
	const details = { server: message.guildId, channel: message.channelId ?? message.channel?.id, user: message.author.id, message: message.id };
	if (!dependencies.isAIEnabled() || !message.content.trim()) {
		logData("AI message not processed; AI is turned off or the message has no text", details, dependencies.logger.debug);
		return;
	}
	const channel = message.channel as SendableChannels;
	if (activeChannels.has(channel.id) || activeChannels.size >= 4) {
		logData("AI message skipped; already replying in this channel or busy in other channels", details, dependencies.logger.debug);
		return;
	}
	activeChannels.add(channel.id);
	let replyAttempted = false;
	const memoryEnabled = dependencies.memoryEnabled?.() !== false;
	logData(memoryEnabled ? "Preparing an AI reply with saved conversation memory" : "Preparing an AI reply without saving conversation memory", details, dependencies.logger.debug);
	try {
		let context: MessageContext[] = [];
		try {
			context = memoryEnabled ? await dependencies.getConversationContext({
				channelId: channel.id,
				currentMessage: message.content,
				recentCount: CONTEXT_RECENT_COUNT,
				similarCount: CONTEXT_SIMILAR_COUNT,
			}) : [];
		}
		catch (error) {
			logData("Could not read AI memory; continuing without saved messages", { ...details, reason: dataErrorReason(error) }, dependencies.logger.error);
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
		logData("Sent the AI reply; text is not included in logs", { ...details, count: chunks.length, characters: chunks.join("").length }, dependencies.logger.debug);
		try {
			if (memoryEnabled) {
				await dependencies.storeMessage({
					channelId: channel.id, messageId: message.id, userId: message.author.id,
					username: message.author.username, role: "user", content: message.content,
				});
				await dependencies.storeMessage({
					channelId: channel.id, messageId: `${message.id}-reply`, userId: message.client.user.id,
					username: "Caitlyn", role: "assistant", content: chunks.join(""),
				});
			}
		}
		catch (error) {
			logData("AI reply sent, but the conversation could not be saved to memory", { ...details, reason: dataErrorReason(error) }, dependencies.logger.error);
		}
	}
	catch (error) {
		logData("Could not finish the AI reply", { ...details, reason: dataErrorReason(error) }, dependencies.logger.error);
		if (!replyAttempted) {
			try {
				await channel.send("Sorry, I encountered an error processing your message. Please try again.");
			}
			catch (sendError) {
				logData("Could not send the AI error message to Discord", { ...details, reason: dataErrorReason(sendError) }, dependencies.logger.error);
			}
		}
	}
	finally {
		activeChannels.delete(channel.id);
	}
}

export { caitlynAI };
