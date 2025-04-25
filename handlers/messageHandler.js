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

const { socialMediaMessage } = require("../messages/socialMediaMessage.js");
const { addMemory } = require("../core/memory.js");

async function messageHandler(message) {
	// Check if the message is from a bot or if it doesn't contain any content
	if (message.author.bot || !message.content) return;

	await addMemory(
		`${message.author.username} said: "${message.content}"`,
		`msg-${message.id}`,
		{
			author: message.author.username,
			timestamp: new Date().toISOString(),
			channel: message.channel.name,
		}
	);

	// Social media message handling for embedding
	socialMediaMessage(message);
}

module.exports = { messageHandler };
