/**
 * @file socialInstagramPost.ts
 * @description Normalizes public Instagram product metadata without dropping carousel photos or trusting thumbnails as videos.
 * Missing items, ambiguous audio and truncated captions never qualify as a complete replacement.
 *
 * @module socialInstagramPost
 */

import type { InstagramFailureReason, InstagramPost, XPostMedia, XVideoVariant } from "../types/socialMedia.js";

export function sanitizeInstagramReason(value: unknown): InstagramFailureReason | undefined {
	return typeof value === "string" && ["http_401", "http_403", "http_404", "http_429", "http_redirect", "page_metadata_missing", "page_restricted", "login_required", "private_post", "query_failed"].includes(value)
		? value as InstagramFailureReason : undefined;
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dimension(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 20_000 ? value : undefined;
}

function bounded(value: string, limit: number): string {
	return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "");
}

export function instagramMediaUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length > 8_192 || /[\s\\\p{Cc}]/u.test(value)) return;
	try {
		const url = new URL(value);
		if (!/^https:\/\/[a-z0-9.-]+\//i.test(value) || url.username || url.password || url.port || url.hash
			|| /\/(?:\.|\.\.)(?:\/|$)|%(?:2e|2f|5c)/i.test(value.split("?", 1)[0])
			|| !["cdninstagram.com", "fbcdn.net"].some((host) => url.hostname.endsWith(`.${host}`))) return;
		return value;
	}
	catch { return; }
}

/** Match the shortcode to the actual numeric media identity, not just an echoed request. */
export function instagramPk(shortcode: string): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	return [...shortcode].reduce((value, character) => value * 64n + BigInt(alphabet.indexOf(character)), 0n).toString();
}

export function normalizeInstagramPost(value: unknown, url: string): { outcome: "ready" | "partial"; post: InstagramPost }
	| { outcome: "invalid_response" | "restricted" | "unsupported"; instagramReason?: InstagramFailureReason } {
	const id = url.match(/^https:\/\/www\.instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]{1,28})\/$/)?.[1];
	const input = object(value);
	if (!id || typeof input.pk !== "string" || input.pk !== instagramPk(id) || (input.code !== undefined && input.code !== id)) return { outcome: "invalid_response" };
	const user = object(input.user);
	if (user.is_private === true) return { outcome: "restricted", instagramReason: "private_post" };
	if (typeof user.username !== "string" || !/^[a-z0-9_.]{1,30}$/i.test(user.username)) return { outcome: "invalid_response" };
	if (typeof input.media_type !== "number" || ![1, 2, 8].includes(input.media_type)) return { outcome: "unsupported" };
	const caption = object(input.caption).text;
	const textComplete = (input.caption === null || typeof caption === "string") && (typeof caption !== "string" || caption.length <= 25_000);
	const post: InstagramPost = { platform: "instagram", id, url, author: { handle: user.username,
		name: typeof user.full_name === "string" && user.full_name ? bounded(user.full_name, 200) : user.username },
	text: typeof caption === "string" ? bounded(caption, 25_000) : "", textComplete, issues: textComplete ? [] : ["incomplete_text"], media: [] };
	const nodes = input.media_type === 8 ? input.carousel_media : [input];
	if (!Array.isArray(nodes) || !nodes.length || nodes.length > 100) return { outcome: "invalid_response" };
	if (input.media_type === 8 && (!Number.isSafeInteger(input.carousel_media_count) || input.carousel_media_count !== nodes.length)) post.issues.push("invalid_media");
	if (nodes.length > 8) post.issues.push("media_limit");
	const seen = new Set<string>();
	for (const raw of nodes.slice(0, 8)) {
		const node = object(raw);
		const mediaId = typeof node.pk === "string" ? node.pk : "";
		const media: XPostMedia = { id: mediaId, kind: node.media_type === 1 ? "image" : "video", variants: [] };
		if (!/^[1-9]\d{0,24}$/.test(mediaId) || seen.has(mediaId) || typeof node.media_type !== "number" || ![1, 2].includes(node.media_type)) {
			post.issues.push("invalid_media");
			continue;
		}
		seen.add(mediaId);
		if (media.kind === "image") {
			const candidates = object(node.image_versions2).candidates;
			const images = Array.isArray(candidates) && candidates.length <= 128 ? candidates.map(object).filter((image) => instagramMediaUrl(image.url)
				&& (image.width === undefined || dimension(image.width)) && (image.height === undefined || dimension(image.height))
				&& (!image.width || !image.height || Number(image.width) * Number(image.height) <= 40_000_000)) : [];
			const selected = images.sort((a, b) => Number(b.width ?? 0) * Number(b.height ?? 0) - Number(a.width ?? 0) * Number(a.height ?? 0))[0];
			if (selected) {
				media.imageUrl = instagramMediaUrl(selected.url);
				// Logged-out GraphQL supplies URL-only candidates. The sandbox probes their actual dimensions.
				media.width = dimension(selected.width);
				media.height = dimension(selected.height);
			}
			else { post.issues.push("invalid_media"); }
			if (typeof node.accessibility_caption === "string") media.alt = bounded(node.accessibility_caption, 1_024);
		}
		else {
			// An explicitly silent clip may be delivered as an original MP4, using the shared GIF audio policy.
			// Unknown audio is NOT evidence of silence; ordinary videos must contain verified AAC audio.
			if (node.has_audio === false) media.kind = "gif";
			if (typeof node.video_duration === "number" && Number.isFinite(node.video_duration) && node.video_duration > 0) media.durationSeconds = node.video_duration;
			const versions = Array.isArray(node.video_versions) && node.video_versions.length <= 128 ? node.video_versions : [];
			const unique = new Map<string, XVideoVariant>();
			for (const entry of versions) {
				const variant = object(entry);
				const candidate = instagramMediaUrl(variant.url);
				if (candidate) unique.set(candidate, { url: candidate, bitrate: 0, width: dimension(variant.width), height: dimension(variant.height) });
			}
			media.variants = [...unique.values()].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0)).slice(0, 32);
			if (!media.variants.length) post.issues.push("unsupported_media");
		}
		post.media.push(media);
	}
	post.issues = [...new Set(post.issues)];
	return { outcome: post.issues.length ? "partial" : "ready", post };
}
