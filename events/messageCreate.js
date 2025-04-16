/**
 * @file messageCreate.js
 * @description This module handles the `messageCreate` event for a Discord.js bot.
 * It is triggered whenever a new message is sent in a text channel the bot has access to.
 *
 * The event listener checks if the message is from a bot or contains no content, and ignores it.
 *
 * @module messageCreate
 */
const { Events } = require("discord.js");
const { messageHandler } = require("../handlers/messageHandler.js");

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		// Message handler for processing incoming messages
		messageHandler(message);
	},
};
