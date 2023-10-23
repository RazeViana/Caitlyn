const { Events } = require('discord.js');

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;

		// Changes twitter.com links with the vx at the back
		const twitterBaseURL = 'https://twitter.com';
		const vxtwitterBaseURL = 'https://vxtwitter.com';

		if (message.content.startsWith(twitterBaseURL)) {
			const modifiedContent = message.content.replace(twitterBaseURL, vxtwitterBaseURL);

			await message.delete();

			message.channel.send(`${message.author.tag}: ${modifiedContent}`);
		}
	},
};