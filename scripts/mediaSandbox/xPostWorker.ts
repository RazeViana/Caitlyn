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

const execute = promisify(execFile);
const outcomes = new Set(["rate_limited", "login_or_restriction", "access_denied", "gateway_denied", "unavailable", "timeout", "size_limit", "output_limit", "invalid_input", "invalid_image", "invalid_media", "redirect_denied", "extractor_error", "duration_limit", "audio_unverified"]);
interface VerificationDependencies {
	byteLimit?: number;
	retrieve: typeof retrieve;
	execute: (command: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
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
	if (media.durationSeconds && media.durationSeconds > 900) return { outcome: "duration_limit" };
	for (const variant of candidates.slice(0, 4)) {
		try {
			const limit = dependencies.byteLimit ?? 10 * 1_024 * 1_024;
			const download = await dependencies.retrieve("video", variant.url, dependencies.byteLimit) as { bytes: number };
			if (!Number.isSafeInteger(download.bytes) || download.bytes <= 0 || download.bytes > limit) throw new Error("size_limit");
			const inspected = await dependencies.execute("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
				"stream=codec_type,codec_name,width,height:format=duration", "-of", "json", "/tmp/x-video.mp4"], { timeout: 5_000, maxBuffer: 32_768 });
			const inspectedMedia = JSON.parse(inspected.stdout);
			const streams = Array.isArray(inspectedMedia.streams) ? inspectedMedia.streams : [];
			const video = streams.filter((stream: { codec_type?: string }) => stream.codec_type === "video");
			const audio = streams.filter((stream: { codec_type?: string }) => stream.codec_type === "audio");
			const duration = Number(inspectedMedia.format?.duration);
			if (!Number.isFinite(duration) || duration <= 0 || duration > 900) throw new Error("duration_limit");
			if (video.length !== 1 || video[0].codec_name !== "h264" || !Number.isSafeInteger(video[0].width) || !Number.isSafeInteger(video[0].height)
				|| video[0].width <= 0 || video[0].height <= 0 || video[0].width * video[0].height > 40_000_000) throw new Error("invalid_media");
			if (audio.some((stream: { codec_name?: string }) => stream.codec_name !== "aac") || (media.kind === "video" && !audio.length)) throw new Error("audio_unverified");
			await dependencies.execute("ffmpeg", ["-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-i", "/tmp/x-video.mp4",
				"-t", "2", "-f", "null", "-"], { timeout: 8_000, maxBuffer: 32_768 });
			return { outcome: "video_verified", bytes: download.bytes, durationSeconds: duration, streams, firstTwoSecondsDecode: true };
		}
		catch (error) {
			// Only a byte-limit failure can select a smaller variant; access failures never trigger retries.
			if (error instanceof Error && error.message === "size_limit") continue;
			return { outcome: error instanceof Error && outcomes.has(error.message) ? error.message : "video_validation_failed" };
		}
	}
	return { outcome: "size_limit" };
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
export async function deliverXPost(url: string, attachmentBytes: number, totalBytes: number, allowSensitive = false, payload: unknown = undefined): Promise<unknown> {
	const id = url.match(/^https:\/\/x\.com\/[a-zA-Z0-9_]{1,15}\/status\/([1-9]\d{0,24})$/)?.[1];
	if (!id || !Number.isSafeInteger(attachmentBytes) || attachmentBytes < 1_024 || attachmentBytes > 8 * 1_024 * 1_024
		|| !Number.isSafeInteger(totalBytes) || totalBytes < attachmentBytes || totalBytes > 20 * 1_024 * 1_024) return { outcome: "invalid_response" };
	try {
		const adapter = await import(new URL("./socialXPost.ts", import.meta.url).href) as typeof import("../../core/socialXPost.js");
		const { normalizeFxPost } = await import(new URL("./socialFxPost.ts", import.meta.url).href) as typeof import("../../core/socialFxPost.js");
		const result = normalizeFxPost(payload, id, allowSensitive);
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
				const candidates = adapter.xVideoCandidates(media, byteLimit);
				// Estimates are conservative. Probe the smallest variant once if none is predicted to fit.
				if (!candidates.length && media.variants.length) candidates.push(media.variants.at(-1)!);
				const verified = media.kind === "image" ? await verifyImage(media, { retrieve, execute, byteLimit })
					: await verifyVideo(media, candidates, { retrieve, execute, byteLimit });
				if (!["image_verified", "video_verified"].includes(String(verified.outcome))) {
					partial = true;
					mediaFailures.push(String(verified.outcome));
					halted = ["rate_limited", "login_or_restriction", "access_denied", "gateway_denied"].includes(String(verified.outcome));
					continue;
				}
				const data = await readFile(media.kind === "image" ? "/tmp/x-image.bin" : "/tmp/x-video.mp4");
				if (data.length > byteLimit) {
					partial = true;
					mediaFailures.push("size_limit");
					continue;
				}
				remaining -= data.length;
				const extension = media.kind !== "image" ? "mp4" : verified.mime === "image/png" ? "png" : verified.mime === "image/webp" ? "webp" : "jpg";
				files.push({ postId: item.id, mediaId: media.id, extension, base64: data.toString("base64"), sha256: createHash("sha256").update(data).digest("hex") });
			}
		}
		return { version: 1, outcome: partial ? "partial" : "ready", post: result.post, files, mediaFailures };
	}
	catch (error) {
		return retrievalFailure(error);
	}
}
