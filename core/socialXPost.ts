/**
 * @file socialXPost.ts
 * @description Normalizes untrusted X data into bounded text, ordered media, and quotes.
 * Performs no network requests; URL checks do not replace the isolated worker's egress gate.
 *
 * @module socialXPost
 */

import type { XPost, XPostDiagnostic, XPostIssue, XPostMedia, XPostResult, XVideoVariant } from "../types/socialMedia.js";

const diagnosticTypes = new Set(["Tweet", "TweetUnavailable", "TweetTombstone", "TweetWithVisibilityResults", "TweetPreviewDisplay", "FxStatus", "FxTombstone", "missing", "unknown"]);
const diagnosticReasons = new Set(["login_required", "age_required", "protected", "deleted", "unavailable", "subscription_required",
	"unknown_tombstone", "unknown_unavailable", "unexpected_response", "identity_mismatch", "sensitive_disabled", "author_unavailable"]);
const diagnosticSources = new Set(["reason_code", "tombstone_text", "response_shape", "policy"]);

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function at(value: unknown, ...keys: string[]): unknown {
	return keys.reduce((current, key) => record(current)[key], value);
}

/** Rebuild an allowlisted diagnostic at both the worker boundary and the logging boundary. */
export function sanitizeXPostDiagnostic(value: unknown): XPostDiagnostic | undefined {
	const input = record(value);
	if (input.stage !== "metadata" || typeof input.responseType !== "string" || !diagnosticTypes.has(input.responseType)
		|| typeof input.reason !== "string" || !diagnosticReasons.has(input.reason)
		|| typeof input.source !== "string" || !diagnosticSources.has(input.source)
		|| typeof input.hasLegacy !== "boolean" || typeof input.hasTombstoneText !== "boolean") return undefined;
	return { stage: "metadata", responseType: input.responseType as XPostDiagnostic["responseType"],
		reason: input.reason as XPostDiagnostic["reason"], source: input.source as XPostDiagnostic["source"],
		hasLegacy: input.hasLegacy, hasTombstoneText: input.hasTombstoneText };
}

function tombstoneTexts(result: Record<string, unknown>): string[] {
	// Check only explicit notice fields. Never search tweet content, links, or arbitrary nested objects.
	const notice = result.tombstone;
	const candidates = [at(notice, "richText", "text"), at(notice, "text", "text"), at(notice, "text")];
	if (result.__typename === "TweetTombstone") candidates.push(at(result, "richText", "text"), at(result, "text", "text"), result.text);
	return candidates.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 1_024);
}

function failure(result: Record<string, unknown>, outcome: "restricted" | "unavailable" | "invalid_response",
	reason: XPostDiagnostic["reason"], source: XPostDiagnostic["source"] = "response_shape"): XPostResult {
	return { outcome, diagnostic: {
		stage: "metadata", responseType: typeof result.__typename === "string" && diagnosticTypes.has(result.__typename)
			? result.__typename as XPostDiagnostic["responseType"] : result.__typename === undefined ? "missing" : "unknown",
		reason, source, hasLegacy: result.legacy !== null && typeof result.legacy === "object" && !Array.isArray(result.legacy),
		hasTombstoneText: tombstoneTexts(result).length > 0,
	} };
}

function unavailable(result: Record<string, unknown>): XPostResult | undefined {
	const tombstone = result.__typename === "TweetTombstone" || Boolean(result.tombstone);
	if (!tombstone && result.__typename !== "TweetUnavailable" && result.__typename !== "TweetPreviewDisplay") return undefined;
	// A structured provider reason is stronger evidence than human-readable notice wording.
	const reasons = new Map<string, XPostDiagnostic["reason"]>([
		["Protected", "protected"], ["NsfwLoggedOut", "login_required"], ["NsfwViewerHasNoStatedAge", "age_required"],
		["Deleted", "deleted"],
	]);
	let reason = typeof result.reason === "string" ? reasons.get(result.reason) : undefined;
	let source: XPostDiagnostic["source"] = reason ? "reason_code" : "response_shape";
	if (!reason && tombstone) {
		// These are conservative English notice matches, not proof of why a bare tombstone was returned.
		// Unknown/localized/oversized wording stays unknown, and no notice text leaves this function.
		const patterns: [RegExp, XPostDiagnostic["reason"]][] = [
			[/^(?:age-restricted adult content\b|this (?:post|tweet) is age[- ]restricted\b|due to local laws, we are temporarily restricting access to this content until x estimates your age\b)/, "age_required"],
			[/^(?:to view this media, you(?:'ll| will) need to log in\b|please (?:log|sign) in to (?:view|see) this (?:media|post|tweet)\b)/, "login_required"],
			[/^this (?:post|tweet) is from a protected account\b/, "protected"],
			[/^this (?:post|tweet) (?:was|has been) deleted\b/, "deleted"],
			[/^this (?:post|tweet) is from (?:a suspended account|an account that no longer exists)\b/, "author_unavailable"],
			[/^this (?:post|tweet) is unavailable\b/, "unavailable"],
		];
		for (const text of tombstoneTexts(result)) {
			const normalized = text.trim().toLowerCase().replace(/’/g, "'");
			reason = patterns.find(([pattern]) => pattern.test(normalized))?.[1];
			if (reason) {
				source = "tombstone_text";
				break;
			}
		}
	}
	if (!reason) reason = tombstone ? "unknown_tombstone" : result.__typename === "TweetPreviewDisplay" ? "subscription_required" : "unknown_unavailable";
	const restricted = ["login_required", "age_required", "protected", "subscription_required"].includes(reason);
	return failure(result, restricted ? "restricted" : "unavailable", reason, source);
}

function identifier(value: unknown): string | undefined {
	return typeof value === "string" && /^[1-9]\d{0,24}$/.test(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function decodeText(value: string): string {
	const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'" };
	return value.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, entity: string) => entities[entity]);
}

function boundedText(value: string, limit: number): string {
	return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");
}

/** Accept only the expected CDN URL shape, not arbitrary provider-supplied destinations. */
export function xMediaUrl(value: unknown, kind: "image" | "video"): string | undefined {
	if (typeof value !== "string" || value.length > 2_048 || /[\s\\%\p{Cc}]/u.test(value)) return undefined;
	const match = value.match(/^https:\/\/(pbs\.twimg\.com|video\.twimg\.com)(\/[^?#]*)(?:\?[^#]*)?$/);
	if (!match || /\/(?:\.|\.\.)(?:\/|$)/.test(match[2])) return undefined;
	const url = new URL(value);
	if (kind === "image") {
		if (match[1] !== "pbs.twimg.com" || !/^\/media\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(url.pathname)) return undefined;
		// Use the original image, not a preview selected for a webpage layout.
		url.search = "";
		url.searchParams.set("name", "orig");
	}
	else if (match[1] !== "video.twimg.com" || !/^\/[a-zA-Z0-9_./-]+\.mp4$/.test(url.pathname)) {
		return undefined;
	}
	return url.href;
}

function mediaItem(raw: unknown, issues: Set<XPostIssue>): XPostMedia | undefined {
	const item = record(raw);
	const id = identifier(item.id_str);
	if (!id) {
		issues.add("invalid_media");
		return;
	}
	if (!["photo", "video", "animated_gif"].includes(String(item.type))) {
		issues.add("unsupported_media");
		return;
	}
	const kind = item.type === "photo" ? "image" : item.type === "video" ? "video" : "gif";
	const size = record(item.original_info);
	const imageUrl = kind === "image" ? xMediaUrl(item.media_url_https, "image") : undefined;
	const video = record(item.video_info);
	const variants: XVideoVariant[] = [];
	const rawVariants = Array.isArray(video.variants) ? video.variants : [];
	if (rawVariants.length > 32) issues.add("media_limit");
	for (const rawVariant of rawVariants.slice(0, 32)) {
		const variant = record(rawVariant);
		if (variant.content_type !== "video/mp4") continue;
		const url = xMediaUrl(variant.url, "video");
		if (!url) {
			issues.add("invalid_media");
			continue;
		}
		const dimensions = new URL(url).pathname.match(/\/(\d{1,5})x(\d{1,5})\//);
		if (!variants.some((existing) => existing.url === url)) {
			variants.push({
				url, bitrate: positive(variant.bitrate) ?? 0,
				width: dimensions ? Number(dimensions[1]) : undefined, height: dimensions ? Number(dimensions[2]) : undefined,
			});
		}
	}
	if (kind === "image" ? !imageUrl : variants.length === 0) {
		issues.add("invalid_media");
		return;
	}
	return {
		id, kind, imageUrl, variants: variants.sort((a, b) => b.bitrate - a.bitrate),
		alt: typeof item.ext_alt_text === "string" ? decodeText(boundedText(item.ext_alt_text, 1_024)) : undefined,
		width: positive(size.width), height: positive(size.height),
		durationSeconds: positive(video.duration_millis) === undefined ? undefined : Number(video.duration_millis) / 1_000,
	};
}

function normalize(raw: unknown, expectedId: string, depth: number, allowSensitive: boolean): XPostResult {
	let result = record(raw);
	const outerFailure = unavailable(result);
	if (outerFailure) return outerFailure;
	if (result.__typename === "TweetWithVisibilityResults") {
		result = record(result.tweet);
		const innerFailure = unavailable(result);
		if (innerFailure) return innerFailure;
	}
	if (result.__typename !== "Tweet") return failure(result, "invalid_response", "unexpected_response");
	const legacy = record(result.legacy);
	const id = identifier(legacy.id_str) ?? identifier(result.rest_id);
	if (id !== expectedId || (result.rest_id !== undefined && result.rest_id !== id)) return failure(result, "invalid_response", "identity_mismatch");
	const user = record(at(result, "core", "user_results", "result"));
	const userLegacy = record(user.legacy);
	if (userLegacy.protected === true || at(user, "privacy", "protected") === true) return failure(result, "restricted", "protected", "policy");
	if (user.__typename === "UserUnavailable") return failure(result, "restricted", "author_unavailable", "policy");
	if (legacy.possibly_sensitive === true && !allowSensitive) return failure(result, "restricted", "sensitive_disabled", "policy");
	const issues = new Set<XPostIssue>();
	const userCore = record(user.core);
	const rawHandle = userLegacy.screen_name ?? userCore.screen_name;
	const handle = typeof rawHandle === "string" && /^[a-zA-Z0-9_]{1,15}$/.test(rawHandle) ? rawHandle : undefined;
	const rawName = userLegacy.name ?? userCore.name;
	if (!handle || typeof rawName !== "string" || !rawName.trim()) issues.add("missing_author");
	const note = at(result, "note_tweet", "note_tweet_results", "result", "text");
	const sourceText = typeof note === "string" ? note : legacy.full_text;
	// GraphQL supplies full_text but commonly omits the legacy truncated flag.
	// An explicit truncation flag or an unresolved note still marks the text incomplete.
	const textComplete = typeof sourceText === "string" && sourceText.length <= 25_000
		&& (typeof note === "string" || ((legacy.truncated === false || legacy.truncated === undefined) && !result.note_tweet));
	if (!textComplete) issues.add("incomplete_text");
	const rawMedia = at(legacy, "extended_entities", "media");
	const media: XPostMedia[] = [];
	if (rawMedia !== undefined && !Array.isArray(rawMedia)) issues.add("invalid_media");
	if (Array.isArray(rawMedia)) {
		if (rawMedia.length > 4) issues.add("media_limit");
		for (const candidate of rawMedia.slice(0, 4)) {
			const item = mediaItem(candidate, issues);
			if (item && !media.some((existing) => existing.id === item.id)) media.push(item);
			else if (item) issues.add("invalid_media");
		}
	}
	else if (at(legacy, "entities", "media") !== undefined) {
		issues.add("invalid_media");
	}
	// Cards/articles and inline long-form media are not silently declared complete.
	if (result.card || result.article || legacy.retweeted_status_result || at(result, "note_tweet", "note_tweet_results", "result", "media")) issues.add("unsupported_card");
	const post: XPost = {
		...(legacy.possibly_sensitive === true ? { sensitive: true } : {}),
		id, url: `https://x.com/${handle ?? "i"}/status/${id}`,
		author: { name: typeof rawName === "string" && rawName.trim() ? decodeText(boundedText(rawName, 200)) : "Unknown author", handle },
		text: typeof sourceText === "string" ? decodeText(boundedText(sourceText, 25_000)) : "", textComplete,
		media, issues: [],
	};
	const quoteId = identifier(legacy.quoted_status_id_str);
	const quoteResult = at(result, "quoted_status_result", "result");
	if (quoteId || quoteResult !== undefined || legacy.is_quote_status === true) {
		if (depth > 0) {
			issues.add("nested_quote_omitted");
		}
		else {
			const quote = quoteId && quoteId !== id ? normalize(quoteResult, quoteId, depth + 1, allowSensitive) : undefined;
			if (quote && "post" in quote) {
				post.quote = { state: "available", post: quote.post };
			}
			else {
				post.quote = { state: "unavailable", id: quoteId };
				issues.add("quote_unavailable");
			}
		}
	}
	post.issues = [...issues];
	return { outcome: issues.size || (post.quote?.state === "available" && post.quote.post.issues.length) ? "partial" : "ready", post };
}

/** Requires the response to match the requested post, not merely the URL's claimed author. */
export function normalizeXPost(data: unknown, expectedId: string, allowSensitive = false): XPostResult {
	if (!identifier(expectedId)) return { outcome: "invalid_response" };
	return normalize(at(data, "tweetResult", "result"), expectedId, 0, allowSensitive);
}

/** Conservative planning only; a worker must still enforce the actual final byte limit. */
export function xVideoCandidates(media: XPostMedia, byteLimit: number): XVideoVariant[] {
	if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0 || media.kind === "image") return [];
	return media.variants.filter((variant) => {
		if (!media.durationSeconds || !variant.bitrate) return true;
		return (variant.bitrate + 192_000) * media.durationSeconds / 8 * 1.1 <= byteLimit;
	}).sort((a, b) => {
		// Unknown sizes go last; known candidates favor resolution then bitrate.
		if (!a.bitrate || !b.bitrate) return Number(Boolean(b.bitrate)) - Number(Boolean(a.bitrate));
		return (b.height ?? 0) - (a.height ?? 0) || b.bitrate - a.bitrate;
	});
}
