/**
 * @file messageCreate.js
 * @description This module handles the `messageCreate` event for a Discord.js bot.
 * It is triggered whenever a new message is sent in a text channel the bot has access to.
 * Tracks message activity for user statistics and routes to message handlers.
 *
 * @module messageCreate
 */
import { Events } from "discord.js";
import { messageHandler } from "../handlers/messageHandler.js";

export const name = Events.MessageCreate;
export async function execute(message) {
  // Ignore bot messages
  if (message.author.bot) return;

  // Message handler for processing incoming messages
  messageHandler(message);
}
