/**
 * @file ready.js
 * @description This module handles the `ready` event for a Discord.js bot.
 * It is triggered when the bot successfully logs in and becomes ready to interact with Discord.
 *
 * The event listener logs a message to the console indicating that the bot is online
 * and displays the bot's username and discriminator.
 *
 * @module ready
 */

const { Events } = require("discord.js");

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
		console.log(`Ready! Logged in as ${client.user.tag}`);
	},
};
