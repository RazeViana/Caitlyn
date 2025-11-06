/**
 * @file socialMediaMessage.js
 * @description This module provides a function to process and replace social media URLs in Discord messages.
 * It identifies URLs from supported social media platforms (e.g., Instagram, Reddit, TikTok, Twitter),
 * replaces their domains with alternative "ez" domains, and sends the modified URL back to the channel.
 *
 * If a valid URL is found, the original message is deleted, and the updated URL is sent as a new message.
 * This functionality is useful for redirecting users to alternative versions of social media links.
 *
 * Supported platforms include:
 * - Instagram
 * - Reddit
 * - TikTok
 * - Twitter (including x.com)
 *
 * @module socialMediaMessage
 */

async function socialMediaMessage(message) {
	// Extract the URL if it’s the first thing in the message
	const match = message.content.match(
		/^(https?:\/\/(?:www\.)?(instagram\.com|reddit\.com|tiktok\.com|twitter\.com|x\.com)\/\S+)/i
	);
	// If no match, return early
	if (!match) return;

	// Extract the original URL and domain
	const originalUrl = match[1];
	// The domain is the second capturing group
	const domain = match[2].toLowerCase();

	// Map of domains to their replacements
	const ezDomains = {
		"instagram.com": "instagramez.com",
		"reddit.com": "redditez.com",
		"tiktok.com": "tiktokez.com",
		"twitter.com": "twitterez.com",
		"x.com": "twitterez.com",
	};

	// Replace the domain with its corresponding replacement
	const replacement = ezDomains[domain];
	if (!replacement) return;

	// Build the new URL
	const ezUrl = originalUrl.replace(domain, replacement);

	// Delete the original message and send the new URL
	try {
		await message.delete();
		await message.channel.send(`[${domain}](${ezUrl})`);
	} catch (err) {
		console.error("Could not replace URL:", err);
	}
}

export { socialMediaMessage };
