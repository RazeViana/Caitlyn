/**
 * @file caitlynAI.js
 * @description This module provides the main AI handler for Caitlyn.
 * Uses vector-based semantic memory stored in PostgreSQL with pgvector.
 * Retrieves relevant conversation context and sends to Open WebUI for processing.
 * System prompt is configured in Open WebUI model settings.
 *
 * @module caitlynAI
 */

import { chat } from "../core/ollama.js";
import { getConversationContext, storeMessage } from "../core/messageStore.js";
import { isAIEnabled } from "../core/aiState.js";
import logger from "../core/logger.js";

const CONTEXT_RECENT_COUNT = parseInt(process.env.CONTEXT_RECENT_COUNT);
const CONTEXT_SIMILAR_COUNT = parseInt(process.env.CONTEXT_SIMILAR_COUNT);

async function caitlynAI(message) {
  const userMessageFormat = `${message.author.username}: ${message.content}`;

  if (isAIEnabled()) {
    try {
      const channelId = message.channel.id;

      // Get conversation context from vector database
      logger.debug(`Retrieving conversation context`);
      const contextMessages = await getConversationContext({
        channelId,
        currentMessage: message.content,
        recentCount: CONTEXT_RECENT_COUNT,
        similarCount: CONTEXT_SIMILAR_COUNT,
      });

      // Build messages array with context
      const messages = [];

      // Add context messages
      for (const ctx of contextMessages) {
        messages.push({
          role: ctx.role,
          content: `${ctx.username}: ${ctx.content}`,
        });
      }

      // Add current user message
      messages.push({
        role: "user",
        content: userMessageFormat,
      });

      logger.debug(
        `Sending ${messages.length} messages to Open WebUI (including ${contextMessages.length} context messages)`,
      );

      // Send to Open WebUI with channel ID for any additional persistence
      const chatId = `discord-${channelId}`;
      const reply = await chat(messages, chatId);

      if (reply) {
        // Send reply to Discord
        await message.channel.send(reply);

        // Store user message in vector database
        await storeMessage({
          channelId,
          messageId: message.id,
          userId: message.author.id,
          username: message.author.username,
          role: "user",
          content: message.content,
        });

        // Store assistant response in vector database
        await storeMessage({
          channelId,
          messageId: `${message.id}-reply`,
          userId: message.client.user.id,
          username: "Caitlyn",
          role: "assistant",
          content: reply,
        });

        logger.debug(
          `Stored conversation in vector database for channel ${channelId}`,
        );
      }
    } catch (error) {
      logger.error("Error processing AI message:", error);

      // Send error message to user
      await message.channel.send(
        "Sorry, I encountered an error processing your message. Please try again.",
      );
    }
  }
}

export { caitlynAI };
