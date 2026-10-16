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

export function socialEmbedUrl(source: string, origin: string): string {
	const link = parseSocialLink(source);
	if (!link || !supportedSocialLink(link)) throw new Error("unsupported_social_embed_link");
	const path = link.platform === "tiktok" && link.kind === "share" ? `/t/${link.id}` : new URL(link.url).pathname;
	return socialEmbedOrigin(origin) + path;
}
