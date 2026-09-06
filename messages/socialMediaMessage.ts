/**
 * @file socialMediaMessage.ts
 * @description This module provides a function to process and replace social media URLs in Discord messages.
 * It identifies URLs from supported social media platforms (e.g., Instagram, Reddit, TikTok, Twitter),
 * replaces their domains with alternative "ez" domains, and sends the modified URL back to the channel.
 *
 * If a valid URL is found, its replacement is sent before the original is deleted.
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

import type { Message, SendableChannels } from "discord.js";
import logger from "../core/logger.js";

async function socialMediaMessage(message: Message): Promise<void> {
	// Extract the URL if it’s the first thing in the message
	const match = message.content.match(
		/^(https?:\/\/(?:www\.)?(instagram\.com|reddit\.com|tiktok\.com|twitter\.com|x\.com)\/\S+)/i,
	);
	// If no match, return early
	if (!match) return;

	// Extract the original URL and domain
	const originalUrl = match[1];
	// The domain is the second capturing group
	const domain = match[2].toLowerCase();

	// Map of domains to their replacements
	const ezDomains: Record<string, string> = {
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

	// Preserve the original if sending fails; retain any text following the URL.
	try {
		const suffix = message.content.slice(originalUrl.length);
		await (message.channel as SendableChannels).send(`[${domain}](${ezUrl})${suffix}`);
		await message.delete();
	}
	catch (error) {
		logger.warn("Could not complete social link replacement:", error);
	}
}

export { socialMediaMessage };
