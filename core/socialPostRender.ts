/**
 * @file socialPostRender.ts
 * @description Builds caption-first cards with quoting tweets above their quoted content and sharing attribution.
 * Makes no requests, never accepts download URLs as attachments, and never mutates source messages.
 *
 * @module socialPostRender
 */

import type { APIEmbed, MessageCreateOptions } from "discord.js";
import type { SocialPost, XPostMedia } from "../types/socialMedia.js";
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

function authorName(value: string): string {
	// Embed author names are plain text, not Markdown: escapes would appear literally.
	return value.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, " ").replace(/\s+/g, " ").trim();
}

function validAttachment(file: SocialMediaAttachment, media: XPostMedia, limit: number): boolean {
	return Buffer.isBuffer(file.data) && file.data.length > 0 && file.data.length <= limit
		&& (media.kind === "image" ? ["jpg", "png", "webp"].includes(file.extension) : file.extension === "mp4");
}

function mediaLabel(media: readonly XPostMedia[]): string {
	const labels: string[] = [];
	for (const [kind, singular, plural] of [["image", "Image", "images"], ["video", "Video", "videos"], ["gif", "GIF", "GIFs"]] as const) {
		const count = media.filter((item) => item.kind === kind).length;
		if (count) labels.push(count === 1 ? singular : `${count} ${plural}`);
	}
	return labels.join(" · ");
}

export function renderSocialPost(post: SocialPost, attachments: readonly SocialMediaAttachment[], limits: SocialRenderLimits, sharedBy?: string): {
	payload: MessageCreateOptions;
	omittedMedia: number;
	textFileAttached: boolean;
	complete: boolean;
	footerEmbedIndex: number;
} {
	if (!Number.isSafeInteger(limits.attachmentBytes) || limits.attachmentBytes <= 0
		|| !Number.isSafeInteger(limits.messageBytes) || limits.messageBytes <= PAYLOAD_HEADROOM) throw new Error("invalid_social_render_limits");
	// Attribution comes from the source Discord message/job, never provider text or an arbitrary label.
	if (sharedBy !== undefined && (typeof sharedBy !== "string" || !/^[1-9]\d{0,19}$/.test(sharedBy))) throw new Error("invalid_social_sender");
	const posts = [post, ...(post.quote?.state === "available" ? [post.quote.post] : [])];
	const platform = post.platform ?? "x";
	// Text-only posts get reading room; two attributed cards must share Discord's 6,000-character budget.
	const textLimit = !post.media.length && !post.quote ? 3_600 : 1_800;
	const captions = posts.map((item) => escapeText(item.text).trim());
	const embeds: APIEmbed[] = [];
	const files: { attachment: Buffer; name: string; description: string }[] = [];
	let remainingBytes = limits.messageBytes - PAYLOAD_HEADROOM;
	let omittedMedia = 0;
	let textFileAttached = false;
	let footerEmbedIndex = 0;
	// Keep full extracted text available when a card must be shortened. Never silently truncate it.
	if (captions.some((caption) => caption.length > textLimit)) {
		const data = Buffer.from(posts.map((item, index) => `${index ? "Quoted post" : "Post"}: ${item.url}\n${item.author.name} (@${item.author.handle ?? "unknown"})\n\n${item.text}`).join("\n\n---\n\n"), "utf8");
		if (data.length <= limits.attachmentBytes && data.length <= remainingBytes) {
			files.push({ attachment: data, name: `${platform}-post-text.txt`, description: "Full extracted post text and separate quoted-post attribution" });
			remainingBytes -= data.length;
			textFileAttached = true;
		}
	}
	for (const [index, item] of posts.entries()) {
		const escaped = captions[index];
		const notes: string[] = [];
		if (escaped.length > textLimit) notes.push(textFileAttached ? "Full extracted text is attached." : "Text shortened; open the original for the full post.");
		if (!item.textComplete) notes.push("The source did not provide complete text.");
		if (item.issues.length) notes.push("This preview is partial; open the original for missing content.");
		if (item.quote?.state === "unavailable") notes.push("The quoted post is unavailable.");
		const card: APIEmbed = {
			// Keep the quoting author/text on top; the quieter quoted card follows without a large title.
			url: item.url, color: index ? 0x747f8d : platform === "tiktok" ? 0x25f4ee : 0x1d9bf0,
			author: { name: truncate(authorName(`${item.author.name}${item.author.handle ? ` (@${item.author.handle})` : ""}`), 240) || "Unknown author", url: item.url },
			description: truncate(escaped, textLimit) || (item.media.length || item.quote ? undefined : "No text supplied."),
		};
		// End attribution belongs to the last content card, not between the two tweet authors.
		footerEmbedIndex = embeds.length;
		embeds.push(card);
		let missing = 0;
		let imageIndex = 0;
		const imageCount = item.media.filter((media) => media.kind === "image").length;
		for (const [mediaIndex, media] of item.media.entries()) {
			if (media.kind === "image") imageIndex++;
			const file = attachments.find((candidate) => candidate.postId === item.id && candidate.mediaId === media.id);
			if (!file || !validAttachment(file, media, limits.attachmentBytes) || file.data.length > remainingBytes) {
				missing++;
				continue;
			}
			// Names are scoped to this message, readable in the native video player, and contain no job/post IDs.
			const name = `${platform}-${index ? "quote" : "post"}-${media.kind}-${mediaIndex + 1}.${file.extension}`;
			files.push({ attachment: file.data, name, description: truncate(`${index ? "Quoted post" : "Post"} by @${item.author.handle ?? "unknown"}: ${media.alt ?? media.kind}`, 1_024) });
			remainingBytes -= file.data.length;
			if (media.kind === "image") {
				const image = { url: `attachment://${name}` };
				if (!card.image) card.image = image;
				// Leave continuation URLs unset: Discord may deduplicate embeds sharing the same URL.
				else embeds.push({ image, color: card.color, footer: { text: `${index ? "Quoted image" : "Image"} ${imageIndex}/${imageCount} • ${truncate(authorName(item.author.handle ? `@${item.author.handle}` : item.author.name), 80)}` } });
			}
		}
		omittedMedia += missing;
		if (missing) notes.push(`${missing} media item(s) could not be attached; open the original.`);
		const format = [index ? "Quoted post" : item.quote ? "Quote" : undefined, mediaLabel(item.media) || (item.quote ? undefined : "Text")].filter(Boolean).join(" · ");
		const source = `${platform === "tiktok" ? "TikTok" : "X"} · ${format} · [Original ↗](${item.url})`;
		card.description = [card.description, notes.join("\n"), source, index === posts.length - 1 && sharedBy ? `Shared by <@${sharedBy}>` : undefined].filter(Boolean).join("\n\n");
	}
	return {
		payload: { embeds, files, allowedMentions: { parse: [], repliedUser: false } },
		omittedMedia, textFileAttached, footerEmbedIndex,
		complete: !omittedMedia && posts.every((item, index) => item.textComplete && !item.issues.length && (captions[index].length <= textLimit || textFileAttached)),
	};
}

/** Compatibility for existing X-only callers; the runtime uses the platform-aware name. */
export const renderXPost = renderSocialPost;
