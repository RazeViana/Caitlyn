/**
 * @file caitlynAI.js
 * @description This module provides the main AI handler for Caitlyn.
 * Formats user messages and sends them to Open WebUI, which handles conversation history,
 * memory, and web search. System prompt is configured in Open WebUI model settings.
 *
 * @module caitlynAI
 */

import { chat } from "../core/ollama.js";
import logger from "../core/logger.js";

const LLM_ENABLED = process.env.LLM_ENABLED;

async function caitlynAI(message) {
  const userMessageFormat = `Sender:${message.author.username} message: ${message.content}`;
  const caitlynReference = message.content.toLowerCase().includes("caitlyn");

  if (LLM_ENABLED === "true" && caitlynReference) {
    try {
      // Use Discord channel ID as chat_id for persistence in Open WebUI
      const chatId = `discord-${message.channel.id}`;

      // Send single message - Open WebUI handles conversation history via chat_id
      const messages = [
        {
          role: "user",
          content: userMessageFormat,
        },
      ];

      const reply = await chat(messages, chatId);

      if (reply) {
        message.channel.send(reply);
      }
    } catch (error) {
      logger.error("Error processing AI message:", error);
      // Send error message to user
      await message.channel.send(
        "Sorry, I encountered an error processing your message. Please try again.",
      );
    }
  } else if (LLM_ENABLED === "true") {
    logger.info("LLM is enabled but Caitlyn not mentioned");
  } else {
    logger.info("LLM is disabled");
  }
}

export { caitlynAI };
