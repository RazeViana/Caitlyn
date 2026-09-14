/**
 * @file socialTikTokPost.ts
 * @description Normalizes bounded TikTok video metadata from the isolated pinned extractor.
 * Accepts only public TikTok CDN candidates; never treats thumbnails or slideshow audio as a video.
 *
 * @module socialTikTokPost
 */

import type { TikTokPost, XPostMedia, XVideoVariant } from "../types/socialMedia.js";

const cdnDomains = ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "tiktokv.us", "muscdn.com", "byteoversea.com", "ibytedtos.com"];

export function tikTokMediaUrl(input: unknown): string | undefined {
	if (typeof input !== "string" || input.length > 8_192 || /[\s\\\p{Cc}]/u.test(input)) return;
	try {
		const url = new URL(input);
		if (!input.startsWith("https://") || url.username || url.password || url.port || url.hash
			|| !/^https:\/\/[a-z0-9.-]+\//i.test(input) || /\/(?:\.|\.\.)(?:\/|$)|%(?:2e|2f|5c)/i.test(input.split("?", 1)[0])
			|| !(cdnDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
				|| /^v\d{1,3}-webapp(?:-prime)?\.tiktok\.com$/.test(url.hostname))) return;
		return input;
	}
	catch { return; }
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}

function boundedText(value: string, limit: number): string {
	return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, "");
}

export function normalizeTikTokPost(value: unknown, expectedId?: string): { outcome: "ready" | "partial"; post: TikTokPost }
	| { outcome: "invalid_response" | "restricted" | "unsupported" } {
	const input = object(value);
	if (input.extractor_key !== "TikTok" || typeof input.id !== "string" || !/^[1-9]\d{0,24}$/.test(input.id)
		|| (expectedId !== undefined && input.id !== expectedId) || input.entries !== undefined
		|| (input._type !== undefined && input._type !== "video")) return { outcome: "invalid_response" };
	if (input.availability !== undefined && input.availability !== "public") return { outcome: "restricted" };
	if (positive(input.age_limit) || input.is_live === true || input.live_status === "is_live") return { outcome: "restricted" };
	const handle = typeof input.uploader === "string" && /^[a-z0-9_.]{1,32}$/i.test(input.uploader) ? input.uploader : undefined;
	if (!handle || !Array.isArray(input.formats) || input.formats.length > 128) return { outcome: "invalid_response" };
	const variants = new Map<string, XVideoVariant>();
	for (const raw of input.formats) {
		const format = object(raw);
		const url = tikTokMediaUrl(format.url);
		if (!url || format.ext !== "mp4" || (format.protocol !== undefined && format.protocol !== "https")
			|| typeof format.vcodec !== "string" || !/^(h264|avc1)(?:[._-]|$)/i.test(format.vcodec)
			|| typeof format.acodec !== "string" || !/^(aac|mp4a)(?:[._-]|$)/i.test(format.acodec)) continue;
		variants.set(url, { url, bitrate: Math.min((positive(format.tbr) ?? 0) * 1_000, Number.MAX_SAFE_INTEGER),
			estimatedBytes: positive(format.filesize) ?? positive(format.filesize_approx),
			width: positive(format.width), height: positive(format.height) });
	}
	if (!variants.size) return { outcome: "unsupported" };
	const description = typeof input.description === "string" ? input.description : "";
	const textComplete = typeof input.description === "string" && description.length <= 25_000;
	const post: TikTokPost = { platform: "tiktok", id: input.id, url: `https://www.tiktok.com/@${handle}/video/${input.id}`,
		author: { name: typeof input.channel === "string" ? boundedText(input.channel, 200) : handle, handle },
		text: boundedText(description, 25_000), textComplete, issues: textComplete ? [] : ["incomplete_text"],
		media: [{ id: input.id, kind: "video", durationSeconds: positive(input.duration),
			variants: [...variants.values()].sort((a, b) => b.bitrate - a.bitrate).slice(0, 32) }] };
	return { outcome: textComplete ? "ready" : "partial", post };
}

/** Try the highest fitting MP4 first; only an actual byte overflow permits another candidate. */
export function tikTokVideoCandidates(media: XPostMedia, byteLimit: number, smallest = false): XVideoVariant[] {
	return media.variants.filter((variant) => {
		const estimate = variant.estimatedBytes ?? (media.durationSeconds && variant.bitrate ? media.durationSeconds * variant.bitrate / 8 * 1.1 : undefined);
		return estimate === undefined || estimate <= byteLimit;
	}).sort((a, b) => smallest ? (a.estimatedBytes ?? Infinity) - (b.estimatedBytes ?? Infinity) || a.bitrate - b.bitrate : b.bitrate - a.bitrate).slice(0, 4);
}
