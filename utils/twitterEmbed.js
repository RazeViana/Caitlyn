const fetch = require("node-fetch");

const TWITTER_DOMAINS = ["https://twitter.com", "https://x.com"];
const VX_TWITTER_BASE = "https://api.vxtwitter.com";

async function twitterEmbed(message) {
	// Find the first matching Twitter/X domain
	const matchedDomain = TWITTER_DOMAINS.find((domain) =>
		message.content.startsWith(domain)
	);

	if (!matchedDomain) return;

	// Build the vxtwitter API URL
	const vxUrl = message.content.replace(matchedDomain, VX_TWITTER_BASE);

	try {
		const res = await fetch(vxUrl);
		if (!res.ok) throw new Error(`API returned ${res.status}`);

		const { data } = await res.json();
		const mediaUrls = data?.mediaURLs || [];

		if (mediaUrls.length === 0) return; // No media found

		const videoLinks = mediaUrls.filter((url) => url.includes("video"));

		if (videoLinks.length === 0) return; // No videos to send

		// Optional: delete the original tweet message
		await message.delete().catch(console.warn);

		// Clean tweet text (no links/emojis)
		const cleanText = data.text
			?.replace(/https?:\/\/\S+/g, "")
			.replace(
				/([\u2700-\u27BF]|[\uE000-\uF8FF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|\uFE0F|\u200D|[\u2600-\u26FF]|\uD83C[\uDDE6-\uDDFF]|\uD83C[\uDFF0-\uDFFF]|\uD83D[\uDC00-\uDEFF]|\uD83E[\uDD00-\uDDFF])/g,
				""
			)
			.trim();

		const description = cleanText
			? `🗣️ ${message.author}: _"${cleanText}"_`
			: `🎥 Twitter video from ${message.author}`;

		// Send videos one by one (to keep formatting clean)
		await message.channel.send(description);
		for (const videoUrl of videoLinks) {
			await message.channel.send(videoUrl);
		}
	} catch (error) {
		console.error("❌ Error fetching from VXTwitter:", error);
		// Optional: notify the channel
		// await message.channel.send("Couldn’t fetch the video from Twitter/X.");
	}
}

module.exports = twitterEmbed;
