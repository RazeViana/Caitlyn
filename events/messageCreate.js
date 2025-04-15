const { Events } = require("discord.js");
const { twitterEmbed } = require("../utils/twitterEmbed.js");

//TODO Figure out why TF THIS IS NOT WORKING
module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		console.log("Message event triggered");
		// Check if the message is from a bot or if it doesn't contain any content
		if (message.author.bot || !message.content) return;
		console.log("Message received:", message.content);
		twitterEmbed(message);
	},
};
