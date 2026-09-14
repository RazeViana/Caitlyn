/**
 * @file socialWorkerClient.ts
 * @description Calls the private metadata/delivery API over a local Unix socket with separate bounded contracts.
 * Validates every worker field and never follows remote URLs, paths, or redirects in a response.
 *
 * @module socialWorkerClient
 */

import { createHash } from "node:crypto";
import { request } from "node:http";
import type { SocialMetadataProvider, SocialPost, TikTokPost, XPost, XPostIssue, XPostMedia } from "../types/socialMedia.js";
import type { SocialMetadataRequest, SocialMetadataResult, SocialWorkerFailure, SocialWorkerRequest, SocialWorkerResult } from "../types/socialDelivery.js";
import { parseSocialLink, supportedSocialLink } from "./socialLinks.js";
import { sanitizeXPostDiagnostic, xMediaUrl } from "./socialXPost.js";

export const SOCIAL_WIRE_LIMIT = 30 * 1_024 * 1_024;
export const SOCIAL_METADATA_LIMIT = 1_024 * 1_024;
export const SOCIAL_FILE_LIMIT = 8 * 1_024 * 1_024;
export const SOCIAL_TOTAL_LIMIT = 20 * 1_024 * 1_024;
const issues = new Set<XPostIssue>(["missing_author", "incomplete_text", "invalid_media", "unsupported_media", "media_limit", "quote_unavailable", "nested_quote_omitted", "unsupported_card"]);
const failures = new Set(["unavailable", "unsupported", "restricted", "rate_limited", "worker_unavailable", "invalid_response", "timeout"]);
const mediaFailures = new Set(["rate_limited", "login_or_restriction", "restricted", "access_denied", "gateway_denied", "unavailable", "timeout", "size_limit", "output_limit", "invalid_input", "invalid_image", "invalid_media", "redirect_denied", "extractor_error", "duration_limit", "audio_unverified", "video_validation_failed", "image_validation_failed", "not_attempted", "compression_timeout", "compression_incomplete"]);

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_worker_response");
	return value as Record<string, unknown>;
}

function id(value: unknown): string {
	if (typeof value !== "string" || !/^[1-9]\d{0,24}$/.test(value)) throw new Error("invalid_worker_response");
	return value;
}

function text(value: unknown, limit: number): string {
	if (typeof value !== "string" || value.length > limit) throw new Error("invalid_worker_response");
	return value;
}

export function validateSocialWorkerRequest(value: unknown): SocialWorkerRequest {
	const input = object(value);
	const link = typeof input.url === "string" ? parseSocialLink(input.url) : null;
	if (input.version !== 1 || !link || !supportedSocialLink(link) || link.url !== input.url
		|| (input.allowSensitive !== undefined && typeof input.allowSensitive !== "boolean")
		|| !Number.isSafeInteger(input.attachmentBytes) || Number(input.attachmentBytes) < 1_024 || Number(input.attachmentBytes) > SOCIAL_FILE_LIMIT
		|| !Number.isSafeInteger(input.totalBytes) || Number(input.totalBytes) < Number(input.attachmentBytes) || Number(input.totalBytes) > SOCIAL_TOTAL_LIMIT) throw new Error("invalid_worker_request");
	return { version: 1, url: link.url, attachmentBytes: Number(input.attachmentBytes), totalBytes: Number(input.totalBytes),
		...(input.allowSensitive === true ? { allowSensitive: true } : {}) };
}

export function validateSocialMetadataRequest(value: unknown): SocialMetadataRequest {
	const input = object(value);
	if (Object.keys(input).some((key) => !["version", "url", "allowSensitive"].includes(key))) throw new Error("invalid_metadata_request");
	const validated = validateSocialWorkerRequest({ ...input, attachmentBytes: SOCIAL_FILE_LIMIT, totalBytes: SOCIAL_TOTAL_LIMIT });
	if (parseSocialLink(validated.url)?.platform !== "x") throw new Error("invalid_metadata_request");
	return { version: 1, url: validated.url, ...(validated.allowSensitive ? { allowSensitive: true } : {}) };
}

function positiveNumber(value: unknown, integer = false): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER
		|| (integer && !Number.isInteger(value))) throw new Error("invalid_worker_response");
	return value;
}

function post(value: unknown, depth = 0, includeMediaUrls = false): XPost {
	const input = object(value);
	if (input.platform !== undefined && input.platform !== "x") throw new Error("invalid_worker_response");
	const author = object(input.author);
	const handle = author.handle === undefined ? undefined : text(author.handle, 15);
	if (handle !== undefined && !/^[a-zA-Z0-9_]{1,15}$/.test(handle)) throw new Error("invalid_worker_response");
	const postId = id(input.id);
	const url = `https://x.com/${handle ?? "i"}/status/${postId}`;
	if (input.url !== url || typeof input.textComplete !== "boolean" || !Array.isArray(input.media) || input.media.length > 4
		|| !Array.isArray(input.issues) || input.issues.length > issues.size || input.issues.some((item) => !issues.has(item))) throw new Error("invalid_worker_response");
	const media: XPostMedia[] = input.media.map((raw) => {
		const item = object(raw);
		if (typeof item.kind !== "string" || !["image", "video", "gif"].includes(item.kind)) throw new Error("invalid_worker_response");
		const cleaned: XPostMedia = { id: id(item.id), kind: item.kind as XPostMedia["kind"], variants: [], alt: item.alt === undefined ? undefined : text(item.alt, 1_024) };
		if (includeMediaUrls) {
			if (!Array.isArray(item.variants) || item.variants.length > 32) throw new Error("invalid_worker_response");
			cleaned.width = positiveNumber(item.width, true);
			cleaned.height = positiveNumber(item.height, true);
			cleaned.durationSeconds = positiveNumber(item.durationSeconds);
			if (item.kind === "image") {
				cleaned.imageUrl = xMediaUrl(item.imageUrl, "image");
				if (!cleaned.imageUrl || item.variants.length) throw new Error("invalid_worker_response");
			}
			else {
				if (!item.variants.length) throw new Error("invalid_worker_response");
				cleaned.variants = item.variants.map((rawVariant) => {
					const variant = object(rawVariant);
					const mediaUrl = xMediaUrl(variant.url, "video");
					if (!mediaUrl || typeof variant.bitrate !== "number" || !Number.isFinite(variant.bitrate) || variant.bitrate < 0
						|| variant.bitrate > Number.MAX_SAFE_INTEGER) throw new Error("invalid_worker_response");
					return { url: mediaUrl, bitrate: variant.bitrate, width: positiveNumber(variant.width, true), height: positiveNumber(variant.height, true) };
				});
			}
		}
		return cleaned;
	});
	if (new Set(media.map((item) => item.id)).size !== media.length) throw new Error("invalid_worker_response");
	if (input.sensitive !== undefined && typeof input.sensitive !== "boolean") throw new Error("invalid_worker_response");
	const result: XPost = { id: postId, url, author: { name: text(author.name, 200), handle }, text: text(input.text, 25_000), textComplete: input.textComplete, media, issues: input.issues,
		...(input.sensitive === true ? { sensitive: true } : {}) };
	if (input.quote !== undefined) {
		if (depth !== 0) throw new Error("invalid_worker_response");
		const quote = object(input.quote);
		if (quote.state === "available") {
			const quoted = post(quote.post, depth + 1, includeMediaUrls);
			if (quoted.id === postId) throw new Error("invalid_worker_response");
			result.quote = { state: "available", post: quoted };
		}
		else if (quote.state === "unavailable") {result.quote = { state: "unavailable", id: quote.id === undefined ? undefined : id(quote.id) };}
		else {throw new Error("invalid_worker_response");}
	}
	return result;
}

function tikTokPost(value: unknown, requestedUrl: string): TikTokPost {
	const input = object(value);
	const author = object(input.author);
	const handle = text(author.handle, 32);
	const postId = id(input.id);
	const requested = parseSocialLink(requestedUrl);
	if (input.platform !== "tiktok" || !/^[a-z0-9_.]{1,32}$/i.test(handle)
		|| input.url !== `https://www.tiktok.com/@${handle}/video/${postId}` || input.quote !== undefined
		|| requested?.platform !== "tiktok" || (requested.kind === "post" && requested.id !== postId)
		|| typeof input.textComplete !== "boolean" || input.sensitive !== undefined
		|| !Array.isArray(input.media) || input.media.length !== 1 || !Array.isArray(input.issues)
		|| input.issues.length > issues.size || input.issues.some((issue) => !issues.has(issue))) throw new Error("invalid_worker_response");
	const media = object(input.media[0]);
	if (media.id !== postId || media.kind !== "video") throw new Error("invalid_worker_response");
	return { platform: "tiktok", id: postId, url: input.url, author: { handle, name: text(author.name, 200) },
		text: text(input.text, 25_000), textComplete: input.textComplete, issues: input.issues,
		media: [{ id: postId, kind: "video", variants: [] }] };
}

export function decodeSocialWorkerResult(value: unknown, input: SocialWorkerRequest): SocialWorkerResult {
	try {
		const result = object(value);
		const platform = parseSocialLink(input.url)?.platform;
		const expectedProvider = platform === "tiktok" ? "tiktok" : "fxembed";
		if (result.purpose !== undefined && result.purpose !== "delivery") throw new Error("invalid_worker_response");
		if ((result.provider !== undefined && result.provider !== expectedProvider) || (platform === "tiktok" && result.provider !== "tiktok")) throw new Error("invalid_worker_response");
		const provider = result.provider === undefined ? {} : { provider: result.provider as SocialMetadataProvider };
		if (typeof result.outcome === "string" && failures.has(result.outcome)) {
			const diagnostic = sanitizeXPostDiagnostic(result.diagnostic);
			if (platform === "tiktok" && result.diagnostic !== undefined) throw new Error("invalid_worker_response");
			if (result.diagnostic !== undefined && !diagnostic) throw new Error("invalid_worker_response");
			return { outcome: result.outcome, ...provider, ...(diagnostic ? { diagnostic } : {}) } as SocialWorkerResult;
		}
		if (result.version !== 1 || typeof result.outcome !== "string" || !["ready", "partial"].includes(result.outcome)
			|| !Array.isArray(result.files) || result.files.length > 8) throw new Error("invalid_worker_response");
		const normalized: SocialPost = platform === "tiktok" ? tikTokPost(result.post, input.url) : post(result.post);
		const reasons = result.mediaFailures ?? [];
		if (!Array.isArray(reasons) || reasons.length > 8 || reasons.some((reason) => !mediaFailures.has(reason))) throw new Error("invalid_worker_response");
		if (platform !== "tiktok" && normalized.id !== parseSocialLink(input.url)?.id) throw new Error("invalid_worker_response");
		const posts = [normalized, ...(normalized.quote?.state === "available" ? [normalized.quote.post] : [])];
		if (posts.some((item) => item.sensitive) && input.allowSensitive !== true) return { outcome: "restricted" };
		let total = 0;
		const seen = new Set<string>();
		const files = result.files.map((raw) => {
			const file = object(raw);
			const postId = id(file.postId);
			const mediaId = id(file.mediaId);
			const media = posts.find((item) => item.id === postId)?.media.find((item) => item.id === mediaId);
			const key = `${postId}:${mediaId}`;
			const extension = text(file.extension, 4) as "jpg" | "png" | "webp" | "mp4";
			if (!media || seen.has(key) || !(media.kind === "image" ? ["jpg", "png", "webp"] : ["mp4"]).includes(extension)) throw new Error("invalid_worker_response");
			if (file.compressed !== undefined && (typeof file.compressed !== "boolean" || media.kind !== "video")) throw new Error("invalid_worker_response");
			seen.add(key);
			const encoded = text(file.base64, Math.ceil(input.attachmentBytes / 3) * 4);
			if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("invalid_worker_response");
			const data = Buffer.from(encoded, "base64");
			total += data.length;
			if (!data.length || data.length > input.attachmentBytes || total > input.totalBytes
				|| createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error("invalid_worker_response");
			const signature = extension === "png" ? data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
				: extension === "jpg" ? data[0] === 255 && data[1] === 216 && data[2] === 255
					: extension === "webp" ? data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP"
						: data.toString("ascii", 4, 8) === "ftyp";
			if (!signature) throw new Error("invalid_worker_response");
			return { postId, mediaId, extension, data, ...(file.compressed === true ? { compressed: true } : {}) };
		});
		return { outcome: result.outcome as "ready" | "partial", ...provider, post: normalized, files, mediaFailures: reasons };
	}
	catch { return { outcome: "invalid_response" }; }
}

export function decodeSocialMetadataResult(value: unknown, input: SocialMetadataRequest): SocialMetadataResult {
	try {
		const result = object(value);
		if (result.provider !== "fxembed" || result.purpose !== "metadata" || result.files !== undefined) throw new Error("invalid_worker_response");
		if (typeof result.outcome === "string" && failures.has(result.outcome)) {
			const diagnostic = sanitizeXPostDiagnostic(result.diagnostic);
			if (result.diagnostic !== undefined && !diagnostic) throw new Error("invalid_worker_response");
			return { outcome: result.outcome, provider: "fxembed", ...(diagnostic ? { diagnostic } : {}) } as SocialWorkerFailure;
		}
		if (result.version !== 1 || (result.outcome !== "ready" && result.outcome !== "partial")) throw new Error("invalid_worker_response");
		const normalized = post(result.post, 0, true);
		if (normalized.id !== parseSocialLink(input.url)?.id) throw new Error("invalid_worker_response");
		const posts = [normalized, ...(normalized.quote?.state === "available" ? [normalized.quote.post] : [])];
		if (posts.some((item) => item.sensitive) && input.allowSensitive !== true) return { outcome: "restricted", provider: "fxembed" };
		return { version: 1, purpose: "metadata", provider: "fxembed", outcome: posts.some((item) => item.issues.length || !item.textComplete) ? "partial" : result.outcome, post: normalized };
	}
	catch { return { outcome: "invalid_response" }; }
}

async function exchange<Result>(socketPath: string, input: SocialMetadataRequest | SocialWorkerRequest, endpoint: "/v1/x" | "/v1/x/metadata" | "/v1/tiktok",
	limit: number, decode: (value: unknown) => Result, signal?: AbortSignal, timeoutMs = 130_000): Promise<Result | SocialWorkerFailure> {
	if (!socketPath.startsWith("/") || Buffer.byteLength(socketPath) > 100 || /[\p{Cc}]/u.test(socketPath)) return { outcome: "worker_unavailable" };
	return new Promise((resolve) => {
		const deadline = AbortSignal.timeout(timeoutMs);
		const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
		const body = JSON.stringify(input);
		const operation = request({ socketPath, method: "POST", path: endpoint, signal: combined,
			headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (response) => {
			if (response.statusCode !== 200 || !response.headers["content-type"]?.startsWith("application/json")) {
				response.destroy();
				resolve({ outcome: "worker_unavailable" });
				return;
			}
			let size = 0;
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > limit) {
					response.destroy();
					resolve({ outcome: "invalid_response" });
				}
				else {chunks.push(chunk);}
			});
			response.on("error", () => { resolve({ outcome: "worker_unavailable" }); });
			response.on("end", () => {
				try { resolve(decode(JSON.parse(Buffer.concat(chunks).toString()))); }
				catch { resolve({ outcome: "invalid_response" }); }
			});
		});
		operation.on("error", () => { resolve({ outcome: combined.aborted ? "timeout" : "worker_unavailable" }); });
		operation.end(body);
	});
}

export async function requestSocialWorker(socketPath: string, input: SocialWorkerRequest, signal?: AbortSignal, timeoutMs = 130_000): Promise<SocialWorkerResult> {
	const validated = validateSocialWorkerRequest(input);
	return exchange(socketPath, validated, parseSocialLink(validated.url)?.platform === "tiktok" ? "/v1/tiktok" : "/v1/x", SOCIAL_WIRE_LIMIT, (value) => decodeSocialWorkerResult(value, validated), signal, timeoutMs);
}

export async function requestSocialMetadata(socketPath: string, input: SocialMetadataRequest, signal?: AbortSignal, timeoutMs = 60_000): Promise<SocialMetadataResult> {
	const validated = validateSocialMetadataRequest(input);
	return exchange(socketPath, validated, "/v1/x/metadata", SOCIAL_METADATA_LIMIT, (value) => decodeSocialMetadataResult(value, validated), signal, timeoutMs);
}
