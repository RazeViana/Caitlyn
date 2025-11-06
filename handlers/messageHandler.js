/**
 * @file messageHandler.js
 * @description This module handles incoming messages for a Discord.js bot.
 * It processes messages to filter out bot messages and empty content,
 * and utilizes message functions to handle specific message content.
 *
 * The primary function ensures that only valid user messages are processed
 * and delegates further processing to the message functions.
 *
 * @module messageHandler
 */

import { socialMediaMessage } from "../messages/socialMediaMessage.js";
import { caitlynAI } from "../messages/caitlynAI.js";

function messageHandler(message) {
  // Check if the message is from a bot or if it doesn't contain any content
  if (message.author.bot || !message.content) return;

  // Social media message handling for embedding
  socialMediaMessage(message);

  // LLM message handling
  caitlynAI(message);
}

export { messageHandler };
