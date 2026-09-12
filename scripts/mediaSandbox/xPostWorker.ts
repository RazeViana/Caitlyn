/**
 * @file xPostWorker.ts
 * @description Verifies whole-post X metadata, original images, and budgeted clips inside the media sandbox.
 * Keeps raw provider data inside the worker and emits only bounded, content-free summaries.
 *
 * @module xPostWorker
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { XPost, XPostMedia, XVideoVariant } from "../../types/socialMedia.js";

const execute = promisify(execFile);
const outcomes = new Set(["rate_limited", "login_or_restriction", "access_denied", "unavailable", "timeout", "size_limit", "output_limit", "invalid_input", "invalid_image", "invalid_media", "redirect_denied", "extractor_error", "duration_limit", "audio_unverified"]);

interface VerificationDependencies {
	retrieve: typeof retrieve;
	execute: (command: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
}

async function retrieve(kind: "metadata" | "image" | "video", value: string): Promise<unknown> {
	try {
		const result = await execute("/opt/extractor/bin/python", ["/opt/probe/xMetadata.py", kind, value], {
			timeout: kind === "metadata" ? 25_000 : 12_000, killSignal: "SIGKILL", maxBuffer: 1_100_000,
		});
		return JSON.parse(result.stdout);
	}
	catch (error) {
		const failure = error as { killed?: boolean; code?: unknown; stdout?: string };
		let outcome = failure.killed ? "timeout" : failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output_limit" : "extractor_error";
		try {
			const reported = JSON.parse(failure.stdout ?? "{}").failure;
			if (outcomes.has(reported)) outcome = reported;
		}
		catch {
			// Ignore malformed diagnostics, never copy raw output into errors.
		}
		throw new Error(outcome, { cause: error });
	}
}

export async function verifyVideo(media: XPostMedia, candidates: XVideoVariant[], dependencies: VerificationDependencies = { retrieve, execute }): Promise<Record<string, unknown>> {
	if (media.durationSeconds && media.durationSeconds > 900) return { outcome: "duration_limit" };
	for (const variant of candidates.slice(0, 4)) {
		try {
			const download = await dependencies.retrieve("video", variant.url) as { bytes: number };
			if (!Number.isSafeInteger(download.bytes) || download.bytes <= 0 || download.bytes > 10 * 1_024 * 1_024) throw new Error("size_limit");
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
		const download = await dependencies.retrieve("image", media.imageUrl!) as { bytes: number; mime: string };
		if (!Number.isSafeInteger(download.bytes) || download.bytes <= 0 || download.bytes > 12 * 1_024 * 1_024) throw new Error("size_limit");
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

function summary(post: XPost): Record<string, unknown> {
	return {
		postId: post.id, attributed: Boolean(post.author.handle), textCharacters: post.text.length, textComplete: post.textComplete,
		media: post.media.map((media) => ({ id: media.id, kind: media.kind, variants: media.variants.length })), issues: post.issues,
	};
}

export async function probeXPost(url: string): Promise<void> {
	const id = url.match(/^https:\/\/x\.com\/[a-zA-Z0-9_]{1,15}\/status\/([1-9]\d{0,24})$/)?.[1];
	if (!id) throw new Error("invalid_input");
	try {
		// The harness copies this exact shared source into its allowlisted build context.
		// Dynamic loading lets Node's native TS runner use .ts while production imports stay .js.
		const adapter = await import(new URL("./socialXPost.ts", import.meta.url).href) as typeof import("../../core/socialXPost.js");
		const result = adapter.normalizeXPost(await retrieve("metadata", id), id);
		if (!("post" in result)) {
			process.stdout.write(`${JSON.stringify(result)}\n`);
			return;
		}
		const posts = [result.post, ...(result.post.quote?.state === "available" ? [result.post.quote.post] : [])];
		const mediaResults: Record<string, unknown>[] = [];
		let halted = false;
		for (const post of posts) {
			for (const media of post.media) {
				const verified = halted ? { outcome: "not_attempted" } : media.kind === "image" ? await verifyImage(media)
					: await verifyVideo(media, adapter.xVideoCandidates(media, 10 * 1_024 * 1_024));
				mediaResults.push({ postId: post.id, mediaId: media.id, ...verified });
				if (["rate_limited", "login_or_restriction", "access_denied"].includes(String(verified.outcome))) halted = true;
			}
		}
		process.stdout.write(`${JSON.stringify({
			outcome: "x_post_checked", metadataOutcome: result.outcome,
			post: summary(result.post),
			quote: result.post.quote?.state === "available" ? { state: "available", ...summary(result.post.quote.post) } : result.post.quote,
			mediaResults, allMediaVerified: mediaResults.every((item) => ["image_verified", "video_verified"].includes(String(item.outcome))),
		})}\n`);
	}
	catch (error) {
		process.stdout.write(`${JSON.stringify({ outcome: error instanceof Error && outcomes.has(error.message) ? error.message : "extractor_error" })}\n`);
	}
}
