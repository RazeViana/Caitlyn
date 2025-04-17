/**
 * @file twitterVideoMessage.js
 * @description This module provides a utility function to handle embedding Twitter/X content
 * in a Discord channel. It fetches media (e.g., videos) from tweets using the VXTwitter API
 * and sends them to the channel, cleaning up the original message.
 *
 * The function supports multiple Twitter domains and ensures that only video content
 * is processed and shared. It also handles errors gracefully, notifying users if the
 * fetch operation fails.
 *
 * @module twitterVideoMessage
 *
 * @deprecated This module is deprecated.
 */

const { EmbedBuilder } = require("discord.js");

const TWITTER_DOMAINS = ["https://twitter.com", "https://x.com"];
const VX_TWITTER_BASE = "https://api.vxtwitter.com";

async function twitterVideoMessage(message) {
	// Find the first matching Twitter/X domain
	const matchedDomain = TWITTER_DOMAINS.find((domain) =>
		message.content.startsWith(domain)
	);

	if (!matchedDomain) return;

	// Build the vxtwitter API URL
	const vxUrl = message.content.replace(matchedDomain, VX_TWITTER_BASE);

	try {
		// Fetch the data from the VXTwitter API
		const res = await fetch(vxUrl);
		// Check if the response is ok
		if (!res.ok) throw new Error(`API returned ${res.status}`);

		// Parse the response
		const data = await res.json();
		// Check if the data contains media URLs
		const mediaUrls = data?.mediaURLs || [];

		// Check if there are any media URLs
		if (mediaUrls.length === 0) return;

		// Filter the media URLs to get only video links
		const videoLinks = mediaUrls.filter((url) => url.includes("video"));

		// Check if there are any video links
		if (videoLinks.length === 0) return;

		// Delete the original discord message
		await message.delete().catch(console.warn);

		// Clean tweet text (no links/emojis)
		// const cleanText = data.text
		// 	?.replace(/https?:\/\/\S+/g, "")
		// 	.replace(
		// 		/([\u2700-\u27BF]|[\uE000-\uF8FF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|\uFE0F|\u200D|[\u2600-\u26FF]|\uD83C[\uDDE6-\uDDFF]|\uD83C[\uDFF0-\uDFFF]|\uD83D[\uDC00-\uDEFF]|\uD83E[\uDD00-\uDDFF])/g,
		// 		""
		// 	)
		// 	.trim();

		const embed = new EmbedBuilder()
			.setAuthor({
				name: `${data.user_name} (@${data.user_screen_name})`,
				iconURL: data.user_profile_image_url,
				url: data.tweetURL,
			})
			.setDescription(data.text || "\u200b")
			.setURL(data.tweetURL)
			.setColor("#1DA1F2")
			.setFooter({
				text: "Twitter",
				iconURL: "https://abs.twimg.com/icons/apple-touch-icon-192x192.png",
			})
			.setTimestamp(new Date(data.date))
			// Show a preview image if we have one
			.setImage(data.media_extended?.[0]?.preview_image_url ?? null);

		// Send the embed to the channel
		await message.channel.send({ embeds: [embed] });

		// Send videos one by one (to keep formatting clean)
		for (const videoUrl of videoLinks) {
			await message.channel.send(`[.](${videoUrl})`);
		}
	} catch (error) {
		console.error("[Error] fetching from VXTwitter:", error);
		// Notify the user if the fetch fails
		await message.channel.send("Couldn’t fetch the video from Twitter/X.");
	}
}

module.exports = { twitterVideoMessage };
