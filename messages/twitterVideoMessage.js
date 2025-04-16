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
 */

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
		const cleanText = data.text
			?.replace(/https?:\/\/\S+/g, "")
			.replace(
				/([\u2700-\u27BF]|[\uE000-\uF8FF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|\uFE0F|\u200D|[\u2600-\u26FF]|\uD83C[\uDDE6-\uDDFF]|\uD83C[\uDFF0-\uDFFF]|\uD83D[\uDC00-\uDEFF]|\uD83E[\uDD00-\uDDFF])/g,
				""
			)
			.trim();

		// Format the description
		const description = cleanText
			? `"_${cleanText}_"`
			: `🎥 Twitter video from ${message.author}`;

		// Send videos one by one (to keep formatting clean)
		await message.channel.send(description);
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
