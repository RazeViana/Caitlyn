/**
 * @file messageCreate.ts
 * @description This module handles the `messageCreate` event for a Discord.js bot.
 * It is triggered whenever a new message is sent in a text channel the bot has access to.
 *
 * The event listener checks if the message is from a bot or contains no content, and ignores it.
 *
 * @module messageCreate
 */
import { Events } from "discord.js";
import { messageHandler } from "../handlers/messageHandler.js";
import type { BotEvent } from "../types/event.js";

const event: BotEvent<Events.MessageCreate> = {
	name: Events.MessageCreate,
	async execute(message) {
		// Message handler for processing incoming messages
		if (!message.inGuild()) return;
		await messageHandler(message);
	},
};

export = event;
