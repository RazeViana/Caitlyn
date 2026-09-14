/**
 * @file xPostWorker.ts
 * @description Verifies whole-post X metadata, original images, and budgeted clips inside the media sandbox.
 * Emits content-free probe summaries or explicitly requested bounded delivery bytes with safe diagnostics.
 *
 * @module xPostWorker
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { XPostMedia, XVideoVariant } from "../../types/socialMedia.js";
import type { SocialWorkerFailure } from "../../types/socialDelivery.js";
import type { normalizeFxPost } from "../../core/socialFxPost.js";
import type { xVideoCandidates } from "../../core/socialXPost.js";
import type { compressVideo } from "./videoCompression.js";

const execute = promisify(execFile);
const outcomes = new Set(["rate_limited", "login_or_restriction", "access_denied", "gateway_denied", "unavailable", "timeout", "size_limit", "output_limit", "invalid_input", "invalid_image", "invalid_media", "redirect_denied", "extractor_error", "duration_limit", "audio_unverified"]);
interface VerificationDependencies {
	byteLimit?: number;
	retrieve: typeof retrieve;
	execute: (command: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
}

interface XDeliveryDependencies extends VerificationDependencies {
	normalize: typeof normalizeFxPost;
	candidates: typeof xVideoCandidates;
	readFile: (path: string) => Promise<Buffer>;
	compress?: typeof compressVideo;
}

async function retrieve(kind: "image" | "video", value: string, byteLimit?: number): Promise<unknown> {
	try {
		const args = ["/opt/probe/xMetadata.py", kind, value, ...(byteLimit ? [String(byteLimit)] : [])];
		const options = {
			timeout: 12_000, killSignal: "SIGKILL", maxBuffer: 1_100_000,
		} as const;
		const result = await execute("/opt/extractor/bin/python", args, options);
		return JSON.parse(result.stdout);
	}
	catch (error) {
		const failure = error as { killed?: boolean; code?: unknown; stdout?: string };
		let outcome = failure.killed ? "timeout" : failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output_limit" : "extractor_error";
		try {
			const reported = JSON.parse(failure.stdout ?? "{}");
			if (outcomes.has(reported.failure)) outcome = reported.failure;
		}
		catch {
			// Ignore malformed diagnostics, never copy raw output into errors.
		}
		// eslint-disable-next-line preserve-caught-error -- Raw extractor errors can contain untrusted content.
		throw new Error(outcome);
	}
}

function retrievalFailure(error: unknown): SocialWorkerFailure {
	const reason = error instanceof Error ? error.message : "";
	return { outcome: reason === "rate_limited" ? "rate_limited" : ["login_or_restriction", "access_denied"].includes(reason) ? "restricted"
		: reason === "unavailable" ? "unavailable" : reason === "timeout" ? "timeout" : ["invalid_input", "output_limit"].includes(reason) ? "invalid_response" : "worker_unavailable" };
}

export async function verifyVideo(media: XPostMedia, candidates: XVideoVariant[], dependencies: VerificationDependencies = { retrieve, execute }): Promise<Record<string, unknown>> {
	const shared = await import(new URL("./videoDelivery.ts", import.meta.url).href) as typeof import("./videoDelivery.js");
	return shared.verifyVideo(media, candidates, dependencies);
}

export async function verifyImage(media: XPostMedia, dependencies: VerificationDependencies = { retrieve, execute }): Promise<Record<string, unknown>> {
	try {
		const download = await dependencies.retrieve("image", media.imageUrl!, dependencies.byteLimit) as { bytes: number; mime: string };
		if (!Number.isSafeInteger(download.bytes) || download.bytes <= 0 || download.bytes > (dependencies.byteLimit ?? 12 * 1_024 * 1_024)) throw new Error("size_limit");
		const inspected = await dependencies.execute("ffprobe", ["-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe",
			"-show_entries", "stream=codec_name,width,height", "-of", "json", "/tmp/x-image.bin"], { timeout: 5_000, maxBuffer: 32_768 });
		const streams = JSON.parse(inspected.stdout).streams;
		const stream = Array.isArray(streams) && streams.length === 1 ? streams[0] : undefined;
		if (!stream || !["mjpeg", "png", "webp"].includes(stream.codec_name)
			|| !Number.isSafeInteger(stream.width) || !Number.isSafeInteger(stream.height)
			|| stream.width <= 0 || stream.height <= 0 || stream.width * stream.height > 40_000_000) throw new Error("invalid_image");
		if ((media.width && media.width !== stream.width) || (media.height && media.height !== stream.height)) throw new Error("invalid_image");
		const expectedMime: Record<string, string> = { mjpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
		if (download.mime !== expectedMime[stream.codec_name]) throw new Error("invalid_image");
		await dependencies.execute("ffmpeg", ["-nostdin", "-v", "error", "-xerror", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe",
			"-i", "/tmp/x-image.bin", "-frames:v", "1", "-f", "null", "-"], { timeout: 8_000, maxBuffer: 32_768 });
		return { mediaId: media.id, outcome: "image_verified", bytes: download.bytes, mime: download.mime, ...stream };
	}
	catch (error) {
		return { mediaId: media.id, outcome: error instanceof Error && outcomes.has(error.message) ? error.message : "image_validation_failed" };
	}
}

/** Delivery mode is invoked only with Docker logging disabled; its output contains content and bytes. */
export async function deliverXPost(url: string, attachmentBytes: number, totalBytes: number, allowSensitive = false, payload: unknown = undefined, injected?: XDeliveryDependencies): Promise<unknown> {
	const id = url.match(/^https:\/\/x\.com\/[a-zA-Z0-9_]{1,15}\/status\/([1-9]\d{0,24})$/)?.[1];
	if (!id || !Number.isSafeInteger(attachmentBytes) || attachmentBytes < 1_024 || attachmentBytes > 8 * 1_024 * 1_024
		|| !Number.isSafeInteger(totalBytes) || totalBytes < attachmentBytes || totalBytes > 20 * 1_024 * 1_024) return { outcome: "invalid_response" };
	try {
		const adapter = injected ? undefined : await import(new URL("./socialXPost.ts", import.meta.url).href) as typeof import("../../core/socialXPost.js");
		const fx = injected ? undefined : await import(new URL("./socialFxPost.ts", import.meta.url).href) as typeof import("../../core/socialFxPost.js");
		const { prepareVideoAttachment } = await import(new URL("./videoDelivery.ts", import.meta.url).href) as typeof import("./videoDelivery.js");
		const dependencies: XDeliveryDependencies = injected ?? { retrieve, execute, readFile, normalize: fx!.normalizeFxPost, candidates: adapter!.xVideoCandidates };
		const result = dependencies.normalize(payload, id, allowSensitive);
		if (!("post" in result)) return result;
		const posts = [result.post, ...(result.post.quote?.state === "available" ? [result.post.quote.post] : [])];
		const files = [];
		const mediaFailures: string[] = [];
		let remaining = totalBytes;
		let partial = result.outcome === "partial";
		let halted = false;
		for (const item of posts) {
			for (const media of item.media) {
				const byteLimit = Math.min(attachmentBytes, remaining);
				if (halted || byteLimit < 1_024) {
					partial = true;
					mediaFailures.push(halted ? "not_attempted" : "size_limit");
					continue;
				}
				const verified = media.kind === "image" ? await verifyImage(media, { ...dependencies, byteLimit })
					: await prepareVideoAttachment(media, { ...dependencies, byteLimit, candidates: (limit, smallest) => {
						const candidates = dependencies.candidates(media, limit, smallest);
						// Retain the conservative original-budget probe, but never bypass the larger-source estimate cap.
						if (!smallest && !candidates.length && media.variants.length) candidates.push(media.variants.at(-1)!);
						return candidates;
					} });
				if (!["image_verified", "video_verified"].includes(String(verified.outcome))) {
					partial = true;
					mediaFailures.push(String(verified.outcome));
					halted = ["rate_limited", "login_or_restriction", "restricted", "access_denied", "gateway_denied"].includes(String(verified.outcome));
					continue;
				}
				const data = await dependencies.readFile(media.kind === "image" ? "/tmp/x-image.bin" : "/tmp/x-video.mp4");
				if (data.length > byteLimit) {
					partial = true;
					mediaFailures.push("size_limit");
					continue;
				}
				if (!data.length || data.length !== verified.bytes) return { outcome: "invalid_response" };
				remaining -= data.length;
				const extension = media.kind !== "image" ? "mp4" : verified.mime === "image/png" ? "png" : verified.mime === "image/webp" ? "webp" : "jpg";
				files.push({ postId: item.id, mediaId: media.id, extension, base64: data.toString("base64"), sha256: createHash("sha256").update(data).digest("hex"),
					...(verified.compressed === true ? { compressed: true } : {}) });
			}
		}
		return { version: 1, outcome: partial ? "partial" : "ready", post: result.post, files, mediaFailures };
	}
	catch (error) {
		return retrievalFailure(error);
	}
}
