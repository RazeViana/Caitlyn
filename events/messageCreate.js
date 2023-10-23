const { Events, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		if (message.author.bot) return;

		// Changes twitter.com links with the vx at the back
		const twitterBaseURL = 'https://twitter.com';
		const vxtwitterAPIBaseURL = 'https://api.vxtwitter.com';

		if (message.content.startsWith(twitterBaseURL)) {
			try {
				const vxTwitterAPI = await axios.get(message.content.replace(twitterBaseURL, vxtwitterAPIBaseURL));

				// Checks if twitter post contains a video
				if (vxTwitterAPI.data.mediaURLs.length === 1 && vxTwitterAPI.data.mediaURLs[0].includes('video')) {
					await message.delete();
					message.channel.send(`${vxTwitterAPI.data.mediaURLs[0]}`);
					message.channel.send(`${vxTwitterAPI.data.text.replace(/https?:\/\/\S+/g, '')} \n @${vxTwitterAPI.data.user_name}`);
				}
				// // checks if twitter post contains a single image
				// else if (vxTwitterAPI.data.mediaURLs.length === 1 && vxTwitterAPI.data.mediaURLs[0].includes('img')) {
				// 	const twitterImageEmbed = new EmbedBuilder()
				// 		.setAuthor({ name: `@ ${vxTwitterAPI.data.user_name}`, url: vxTwitterAPI.data.tweetURL })
				// 		.setTitle(vxTwitterAPI.data.user_screen_name)
				// 		.setURL(vxTwitterAPI.data.tweetURL)
				// 		.setThumbnail('https://pbs.twimg.com/profile_images/1683899100922511378/5lY42eHs_400x400.jpg')
				// 		.setColor(4506111)
				// 		.setDescription(vxTwitterAPI.data.text)
				// 		.setImage(vxTwitterAPI.data.mediaURLs[0])
				// 		.setFooter({ text: message.author.tag, iconURL: message.author.avatarURL() });

				// 	await message.delete();
				// 	message.channel.send({ embeds: [twitterImageEmbed] });
				// }

				// // Multiple Image Embed
				// if (vxTwitterAPI.data.mediaURLs.length > 1) {
				// 	const twitterEmbeds = new EmbedBuilder()
				// 		.setAuthor({ name: `@ ${vxTwitterAPI.data.user_name}`, url: vxTwitterAPI.data.tweetURL })
				// 		.setTitle(vxTwitterAPI.data.user_screen_name)
				// 		.setURL(vxTwitterAPI.data.tweetURL)
				// 		.setThumbnail('https://pbs.twimg.com/profile_images/1683899100922511378/5lY42eHs_400x400.jpg')
				// 		.setColor(4506111)
				// 		.setDescription(vxTwitterAPI.data.text)
				// 		.setImage(vxTwitterAPI.data.mediaURLs[0])
				// 		.setFooter({ text: message.author.tag, iconURL: message.author.avatarURL() });

				// 	const twitterEmbeds1 = new EmbedBuilder()
				// 		.setURL(vxTwitterAPI.data.tweetURL)
				// 		.setImage(vxTwitterAPI.data.mediaURLs[1]);

				// 	const twitterEmbeds2 = new EmbedBuilder()
				// 		.setURL(vxTwitterAPI.data.tweetURL)
				// 		.setImage(vxTwitterAPI.data.mediaURLs[1]);

				// 	await message.delete();
				// 	message.channel.send({ embeds: [twitterEmbeds, twitterEmbeds1, twitterEmbeds2] });
				// }
			}
			catch (error) {
				// twitter link not real
			}
		}
	},
};
