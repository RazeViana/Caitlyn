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

const { twitterVideoMessage } = require("../messages/twitterVideoMessage.js");

function messageHandler(message) {
	// Check if the message is from a bot or if it doesn't contain any content
	if (message.author.bot || !message.content) return;

	// Call the twitterEmbed function to process the message
	twitterVideoMessage(message);
}

module.exports = { messageHandler };
