/**
 * @file socialFxPost.ts
 * @description Normalizes FxEmbed's API v2 into bounded, separately attributed X posts.
 * Treats backend data as untrusted and accepts only original X CDN media.
 *
 * @module socialFxPost
 */

import { createHash } from "node:crypto";
import type { XPost, XPostIssue, XPostMedia, XPostResult, XVideoVariant, XPostDiagnostic } from "../types/socialMedia.js";
import type { SocialWorkerFailure } from "../types/socialDelivery.js";

// The same source is copied into the native-TypeScript media image.
const { xMediaUrl } = await import(new URL(import.meta.url.endsWith(".ts") ? "./socialXPost.ts" : "./socialXPost.js", import.meta.url).href) as typeof import("./socialXPost.js");

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,24}$/.test(value);
const positive = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
const bounded = (text: string, limit: number): string => text.slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");

function failure(outcome: "restricted" | "unavailable" | "invalid_response", reason: XPostDiagnostic["reason"], tombstone = false): XPostResult {
	return { outcome, diagnostic: { stage: "metadata", responseType: tombstone ? "FxTombstone" : "FxStatus", reason,
		source: reason === "sensitive_disabled" ? "policy" : "response_shape", hasLegacy: false, hasTombstoneText: false } };
}

function mediaItem(value: unknown, postId: string, index: number, issues: Set<XPostIssue>): XPostMedia | undefined {
	const raw = object(value);
	if (!["photo", "video", "gif"].includes(String(raw.type))) {
		issues.add("unsupported_media");
		return;
	}
	const kind = raw.type === "photo" ? "image" : raw.type === "gif" ? "gif" : "video";
	const imageUrl = kind === "image" ? xMediaUrl(raw.url, "image") : undefined;
	const variants: XVideoVariant[] = [];
	const formats = Array.isArray(raw.formats) ? raw.formats : [];
	if (formats.length > 32) issues.add("media_limit");
	for (const candidate of [...formats.slice(0, 32), { url: raw.url }]) {
		const format = object(candidate);
		// Unsupported codecs/streaming manifests are not downloadable Discord attachments.
		if (format.container !== undefined && format.container !== "mp4") continue;
		if (format.codec !== undefined && format.codec !== "h264") continue;
		const url = xMediaUrl(format.url, "video");
		if (!url || variants.some((item) => item.url === url)) continue;
		variants.push({ url, bitrate: positive(format.bitrate) ?? 0, width: positive(format.width), height: positive(format.height) });
	}
	if ((kind === "image" && !imageUrl) || (kind !== "image" && !variants.length)) {
		issues.add("invalid_media");
		return;
	}
	if (variants.length > 32) issues.add("media_limit");
	// Some upstream media lack IDs; bind a deterministic local ID to this post, position, and URL.
	const mediaId = id(raw.id) ? raw.id : BigInt("0x" + createHash("sha256").update(postId + ":" + index + ":" + String(raw.url)).digest("hex").slice(0, 16)).toString();
	return { id: mediaId === "0" ? "1" : mediaId, kind, ...(imageUrl ? { imageUrl } : {}),
		alt: typeof raw.altText === "string" ? bounded(raw.altText, 1024) : undefined,
		width: Number.isSafeInteger(raw.width) ? positive(raw.width) : undefined,
		height: Number.isSafeInteger(raw.height) ? positive(raw.height) : undefined,
		durationSeconds: positive(raw.duration),
		variants: kind === "image" ? [] : variants.sort((a, b) => b.bitrate - a.bitrate).slice(0, 32) };
}

function normalize(value: unknown, expectedId: string, allowSensitive: boolean, depth: number): XPostResult {
	const raw = object(value);
	if (raw.type === "tombstone") {
		if (raw.provider !== "twitter" || (raw.id !== undefined && raw.id !== expectedId)) return failure("invalid_response", "identity_mismatch", true);
		const restricted = raw.reason === "private" || raw.reason === "blocked";
		return failure(restricted ? "restricted" : "unavailable", restricted ? "protected" : raw.reason === "deleted" ? "deleted" : "unavailable", true);
	}
	if (!id(expectedId) || raw.type !== "status" || raw.provider !== "twitter" || raw.id !== expectedId) return failure("invalid_response", "identity_mismatch");
	const author = object(raw.author);
	if (author.protected === true) return failure("restricted", "protected");
	if (raw.possibly_sensitive !== undefined && typeof raw.possibly_sensitive !== "boolean") return failure("invalid_response", "unexpected_response");
	const sensitive = raw.possibly_sensitive === true;
	if (sensitive && !allowSensitive) return failure("restricted", "sensitive_disabled");
	if (typeof author.screen_name !== "string" || !/^[a-zA-Z0-9_]{1,15}$/.test(author.screen_name)
		|| typeof author.name !== "string" || !author.name.trim() || author.name.length > 200) return failure("invalid_response", "author_unavailable");
	if (typeof raw.text !== "string" || !raw.media || typeof raw.media !== "object" || Array.isArray(raw.media)) return failure("invalid_response", "unexpected_response");
	const issues = new Set<XPostIssue>();
	const textComplete = raw.text.length <= 25_000;
	if (!textComplete) issues.add("incomplete_text");
	if (raw.poll || raw.article || raw.card || raw.community_note || raw.reposted_by) issues.add("unsupported_card");
	const container = object(raw.media);
	// Only "all" establishes the order of mixed images/videos; do not reconstruct an unknown ordering.
	const list = Array.isArray(container.all) ? container.all : [];
	const expectedMediaCount = (Array.isArray(container.photos) ? container.photos.length : 0) + (Array.isArray(container.videos) ? container.videos.length : 0);
	if ((container.all !== undefined && !Array.isArray(container.all)) || expectedMediaCount > list.length) issues.add("invalid_media");
	if (container.external || container.broadcast) issues.add("unsupported_media");
	if (list.length > 4) issues.add("media_limit");
	const media = list.slice(0, 4).map((item, index) => mediaItem(item, expectedId, index, issues)).filter((item): item is XPostMedia => Boolean(item));
	if (new Set(media.map((item) => item.id)).size !== media.length) return failure("invalid_response", "unexpected_response");
	const post: XPost = { id: expectedId, url: "https://x.com/" + author.screen_name + "/status/" + expectedId,
		author: { name: author.name, handle: author.screen_name }, text: bounded(raw.text, 25_000), textComplete, media, issues: [],
		...(sensitive ? { sensitive: true } : {}) };
	if (raw.quote !== undefined && raw.quote !== null) {
		if (depth) {issues.add("nested_quote_omitted");}
		else {
			const quoteId = object(raw.quote).id;
			const quoted = id(quoteId) && quoteId !== expectedId ? normalize(raw.quote, quoteId, allowSensitive, 1) : undefined;
			if (quoted?.outcome === "restricted") return quoted;
			if (quoted && "post" in quoted) {post.quote = { state: "available", post: quoted.post };}
			else {
				post.quote = { state: "unavailable", ...(id(quoteId) ? { id: quoteId } : {}) };
				issues.add("quote_unavailable");
			}
		}
	}
	post.issues = [...issues];
	return { outcome: issues.size || (post.quote?.state === "available" && post.quote.post.issues.length) ? "partial" : "ready", post };
}

/** Only the focal post is rendered, not surrounding replies or arbitrary thread members. */
export function normalizeFxPost(payload: unknown, expectedId: string, allowSensitive = false): XPostResult | SocialWorkerFailure {
	const body = object(payload);
	if (!id(expectedId)) return failure("invalid_response", "identity_mismatch");
	if (body.code === 401 || body.code === 403) return failure("restricted", "login_required");
	if (body.code === 404) return failure("unavailable", "unavailable");
	if (body.code === 429) return { outcome: "rate_limited" };
	if (typeof body.code === "number" && body.code >= 500 && body.code <= 599) return { outcome: "worker_unavailable" };
	if (body.code !== 200) return failure("invalid_response", "unexpected_response");
	return normalize(body.status, expectedId, allowSensitive, 0);
}
