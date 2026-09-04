/**
 * @file messageStore.ts
 * @description Handles storage and retrieval of Discord messages with vector embeddings.
 * Provides semantic search capabilities using PostgreSQL pgvector extension.
 *
 * @module messageStore
 */

import { pool } from "./createPGPool.js";
import { generateEmbedding } from "./embeddingService.js";
import logger from "./logger.js";
import type { MessageContext, StoredMessage } from "../types/models.js";

export interface StoreMessageInput {
	channelId: string;
	messageId: string;
	userId: string;
	username: string;
	role: "assistant" | "user";
	content: string;
}

export interface SimilarMessageQuery {
	channelId: string;
	query: string;
	limit?: number;
	threshold?: number;
}

export interface ContextQuery {
	channelId: string;
	currentMessage: string;
	recentCount?: number;
	similarCount?: number;
}

/**
 * Store a message with its embedding in the database
 * @param {Object} params - Message parameters
 * @param {string} params.channelId - Discord channel ID
 * @param {string} params.messageId - Discord message ID
 * @param {string} params.userId - Discord user ID
 * @param {string} params.username - Username
 * @param {string} params.role - Message role ('user' or 'assistant')
 * @param {string} params.content - Message content
 * @returns {Promise<number>} - Inserted message ID
 */
async function storeMessage({
	channelId,
	messageId,
	userId,
	username,
	role,
	content,
}: StoreMessageInput): Promise<number> {
	try {
		// Generate embedding for the message content
		const embedding = await generateEmbedding(content);

		// Convert array to PostgreSQL vector format
		const vectorString = `[${embedding.join(",")}]`;

		const query = `
			INSERT INTO discord.messages
			(channel_id, message_id, user_id, username, role, content, embedding)
			VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
			RETURNING id
		`;

		const values = [
			channelId,
			messageId,
			userId,
			username,
			role,
			content,
			vectorString,
		];
		const result = await pool.query<{ id: number }>(query, values);

		const id = result.rows[0].id;
		logger.debug(`Stored message ${content.substring(0, 20)} from ${username}`);

		return id;
	}
	catch (error) {
		logger.error("Error storing message:", error);
		throw error;
	}
}

/**
 * Search for similar messages using vector similarity
 * @param {Object} params - Search parameters
 * @param {string} params.channelId - Discord channel ID to search in
 * @param {string} params.query - Query text to find similar messages
 * @param {number} params.limit - Maximum number of results (default: 5)
 * @param {number} params.threshold - Similarity threshold 0-1 (default: 0.7)
 * @returns {Promise<Array>} - Array of similar messages
 */
async function searchSimilarMessages({
	channelId,
	query,
	limit = 5,
	threshold = 0.7,
}: SimilarMessageQuery): Promise<StoredMessage[]> {
	try {
		// Generate embedding for the query
		const queryEmbedding = await generateEmbedding(query);
		const vectorString = `[${queryEmbedding.join(",")}]`;

		const result = await pool.query<StoredMessage>(
			"SELECT * FROM discord.search_similar_messages($1::vector, $2, $3, $4)",
			[vectorString, channelId, threshold, limit],
		);

		logger.debug(`Found ${result.rows.length} similar messages`);
		return result.rows;
	}
	catch (error) {
		logger.error("Error searching similar messages:", error);
		throw error;
	}
}

/**
 * Get recent messages from a channel
 * @param {string} channelId - Discord channel ID
 * @param {number} limit - Maximum number of messages (default: 10)
 * @returns {Promise<Array>} - Array of recent messages
 */
async function getRecentMessages(
	channelId: string,
	limit = 10,
): Promise<StoredMessage[]> {
	try {
		const result = await pool.query<StoredMessage>(
			"SELECT * FROM discord.get_recent_messages($1, $2)",
			[channelId, limit],
		);

		logger.debug(`Retrieved ${result.rows.length} recent messages`);
		return result.rows;
	}
	catch (error) {
		logger.error("Error getting recent messages:", error);
		throw error;
	}
}

/**
 * Get conversation context for a channel
 * Combines recent messages with semantically similar ones
 * @param {Object} params - Context parameters
 * @param {string} params.channelId - Discord channel ID
 * @param {string} params.currentMessage - Current message to find context for
 * @param {number} params.recentCount - Number of recent messages (default: 5)
 * @param {number} params.similarCount - Number of similar messages (default: 3)
 * @returns {Promise<Array>} - Array of contextual messages
 */
async function getConversationContext({
	channelId,
	currentMessage,
	recentCount = 5,
	similarCount = 3,
}: ContextQuery): Promise<MessageContext[]> {
	try {
		// Get recent messages for immediate context
		const recentMessages = await getRecentMessages(channelId, recentCount);

		// Get semantically similar messages for broader context
		const similarMessages = await searchSimilarMessages({
			channelId,
			query: currentMessage,
			limit: similarCount,
			threshold: 0.75,
		});

		// Combine and deduplicate messages
		const messageMap = new Map<number, MessageContext>();

		// Add recent messages (higher priority)
		for (const msg of recentMessages) {
			messageMap.set(msg.id, { ...msg, source: "recent" });
		}

		// Add similar messages (if not already included)
		for (const msg of similarMessages) {
			if (!messageMap.has(msg.id)) {
				messageMap.set(msg.id, { ...msg, source: "similar" });
			}
		}

		// Convert to array and sort by created_at
		const context = Array.from(messageMap.values()).sort(
			(a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
		);

		logger.debug(`Built context with ${context.length} messages`);
		return context;
	}
	catch (error) {
		logger.error("Error getting conversation context:", error);
		throw error;
	}
}

/**
 * Clear old messages from a channel (older than N days)
 * @param {string} channelId - Discord channel ID
 * @param {number} daysToKeep - Number of days of history to keep (default: 30)
 * @returns {Promise<number>} - Number of deleted messages
 */
async function clearOldMessages(
	channelId: string,
	daysToKeep = 30,
): Promise<number> {
	try {
		const query = `
			DELETE FROM discord.messages
			WHERE channel_id = $1
			AND created_at < NOW() - INTERVAL '${daysToKeep} days'
		`;

		const result = await pool.query(query, [channelId]);
		const deletedCount = result.rowCount ?? 0;

		logger.info(
			`Cleared ${deletedCount} old messages from channel ${channelId}`,
		);
		return deletedCount;
	}
	catch (error) {
		logger.error("Error clearing old messages:", error);
		throw error;
	}
}

export {
	storeMessage,
	searchSimilarMessages,
	getRecentMessages,
	getConversationContext,
	clearOldMessages,
};
