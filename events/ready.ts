/**
 * @file ready.ts
 * @description This module handles the `ready` event for a Discord.js bot.
 * It is triggered when the bot successfully logs in and becomes ready to interact with Discord.
 *
 * The event listener logs a message to the console indicating that the bot is online
 * and displays the bot's username and discriminator.
 *
 * @module ready
 */

import { Events, type Client } from "discord.js";
import logger from "../core/logger.js";

export const name = Events.ClientReady;
export const once = true;
export function execute(client: Client<true>): void {
	logger.success(`${client.user.username} is online`);
}
