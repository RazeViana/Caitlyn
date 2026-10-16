/**
 * @file socialEmbed.ts
 * @description Maps supported public post links to the operator's FxEmbed instance without fetching media.
 * Keeps embed origins explicit and strips source tracking parameters.
 *
 * @module socialEmbed
 */

import { isIP } from "node:net";
import { parseSocialLink, supportedSocialLink } from "./socialLinks.js";

export function socialEmbedOrigin(value: string | undefined): string {
	if (!value || value !== value.trim()) throw new Error("invalid_social_embed_origin");
	const url = new URL(value);
	if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
		|| !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || isIP(url.hostname)
		|| /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(url.hostname)) throw new Error("invalid_social_embed_origin");
	return url.origin;
}

/** Discord usernames, never server nicknames or global display names. */
export function socialShareUsername(value: unknown): value is string {
	return typeof value === "string" && /^[a-z0-9_.]{2,32}$/i.test(value);
}

export function socialEmbedUrl(source: string, origin: string, username?: string): string {
	const link = parseSocialLink(source);
	if (!link || !supportedSocialLink(link)) throw new Error("unsupported_social_embed_link");
	const path = link.platform === "tiktok" && link.kind === "share" ? `/t/${link.id}` : new URL(link.url).pathname;
	const url = socialEmbedOrigin(origin) + path;
	if (username === undefined) return url;
	if (!socialShareUsername(username)) throw new Error("invalid_social_share_username");
	// A new URL bypasses Discord's cached cards from the oEmbed-only footer rollout.
	return url + "?shared_by=" + encodeURIComponent(username) + "&v=2";
}

/** Match the persisted delivery without relying on the member's current username. */
export function socialEmbedShareMatches(value: string, source: string, origin: string): boolean {
	try {
		const url = new URL(value);
		const username = url.searchParams.get("shared_by");
		if (!socialShareUsername(username)) return false;
		const current = socialEmbedUrl(source, origin, username);
		// Already-delivered v1 cards still need reconciliation and source cleanup.
		return value === current || value === current.slice(0, -"&v=2".length);
	}
	catch { return false; }
}
