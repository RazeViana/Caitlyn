/**
 * @file socialPostRender.ts
 * @description Builds bounded Discord payloads from normalized posts and already validated media bytes.
 * Makes no requests, never accepts download URLs as attachments, and never mutates source messages.
 *
 * @module socialPostRender
 */

import type { APIEmbed, MessageCreateOptions } from "discord.js";
import type { XPost, XPostMedia } from "../types/socialMedia.js";
import { truncate } from "./textLimits.js";

// Covers bounded UTF-8 embed/alt text plus multipart metadata for at most nine files.
const PAYLOAD_HEADROOM = 128 * 1_024;

export interface SocialMediaAttachment {
	postId: string;
	mediaId: string;
	data: Buffer;
	extension: "jpg" | "png" | "webp" | "mp4";
}

export interface SocialRenderLimits {
	attachmentBytes: number;
	// Caller supplies the applicable Discord request budget, including multipart headroom.
	messageBytes: number;
}

function escapeText(value: string): string {
	return value.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, (character) => ["\n", "\t"].includes(character) ? character : "")
		.replace(/([\\`*_{}[\]()#+.!|~>])/g, "\\$1").replaceAll("<", "‹").replaceAll("@", "@\u200B");
}

function validAttachment(file: SocialMediaAttachment, media: XPostMedia, limit: number): boolean {
	return Buffer.isBuffer(file.data) && file.data.length > 0 && file.data.length <= limit
		&& (media.kind === "image" ? ["jpg", "png", "webp"].includes(file.extension) : file.extension === "mp4");
}

export function renderXPost(post: XPost, attachments: readonly SocialMediaAttachment[], limits: SocialRenderLimits): {
	payload: MessageCreateOptions;
	omittedMedia: number;
	textFileAttached: boolean;
} {
	if (!Number.isSafeInteger(limits.attachmentBytes) || limits.attachmentBytes <= 0
		|| !Number.isSafeInteger(limits.messageBytes) || limits.messageBytes <= PAYLOAD_HEADROOM) throw new Error("invalid_social_render_limits");
	const posts = [post, ...(post.quote?.state === "available" ? [post.quote.post] : [])];
	const embeds: APIEmbed[] = [];
	const files: { attachment: Buffer; name: string; description: string }[] = [];
	let remainingBytes = limits.messageBytes - PAYLOAD_HEADROOM;
	let omittedMedia = 0;
	let textFileAttached = false;
	// Keep full extracted text available when a card must be shortened. Never silently truncate it.
	if (posts.some((item) => escapeText(item.text).length > 1_800)) {
		const data = Buffer.from(posts.map((item, index) => `${index ? "Quoted post" : "Post"}: ${item.url}\n${item.author.name} (@${item.author.handle ?? "unknown"})\n\n${item.text}`).join("\n\n---\n\n"), "utf8");
		if (data.length <= limits.attachmentBytes && data.length <= remainingBytes) {
			files.push({ attachment: data, name: `x-${post.id}-text.txt`, description: "Full extracted post text and separate quoted-post attribution" });
			remainingBytes -= data.length;
			textFileAttached = true;
		}
	}
	for (const [index, item] of posts.entries()) {
		const escaped = escapeText(item.text);
		const notes: string[] = [];
		if (escaped.length > 1_800) notes.push(textFileAttached ? "Full extracted text is attached." : "Text shortened; open the original for the full post.");
		if (!item.textComplete) notes.push("The source did not provide complete text.");
		if (item.issues.length) notes.push("This preview is partial; open the original for missing content.");
		if (item.quote?.state === "unavailable") notes.push("The quoted post is unavailable.");
		const card: APIEmbed = {
			title: index ? "Quoted post on X" : "Post on X", url: item.url, color: 0x1d9bf0,
			author: { name: truncate(escapeText(`${item.author.name}${item.author.handle ? ` (@${item.author.handle})` : ""}`), 240) },
			description: truncate(escaped, 1_800) || "No text supplied.",
		};
		embeds.push(card);
		let missing = 0;
		for (const media of item.media) {
			const file = attachments.find((candidate) => candidate.postId === item.id && candidate.mediaId === media.id);
			if (!file || !validAttachment(file, media, limits.attachmentBytes) || file.data.length > remainingBytes) {
				missing++;
				continue;
			}
			const name = `x-${item.id}-${media.id}.${file.extension}`;
			files.push({ attachment: file.data, name, description: truncate(`${index ? "Quoted post" : "Post"} by @${item.author.handle ?? "unknown"}: ${media.alt ?? media.kind}`, 1_024) });
			remainingBytes -= file.data.length;
			if (media.kind === "image") {
				const image = { url: `attachment://${name}` };
				if (!card.image) card.image = image;
				else embeds.push({ image, footer: { text: `${index ? "Quoted post" : "Post"} • @${item.author.handle ?? "unknown"}` } });
			}
		}
		omittedMedia += missing;
		if (missing) notes.push(`${missing} media item(s) could not be attached; open the original.`);
		if (notes.length) card.description += `\n\n${notes.join("\n")}`;
	}
	return {
		payload: { embeds, files, allowedMentions: { parse: [], repliedUser: false } },
		omittedMedia, textFileAttached,
	};
}
