/**
 * @file videoDelivery.ts
 * @description Shares bounded original-video verification and size-only compression across platform adapters.
 * Adapters supply approved candidates and their downloader; no platform URLs, credentials or access policy live here.
 *
 * @module videoDelivery
 */

import type { compressVideo } from "./videoCompression.js";

interface VideoMedia {
	kind: "image" | "video" | "gif";
	durationSeconds?: number;
}

interface VideoCandidate { url: string }

export interface VideoVerificationDependencies {
	byteLimit?: number;
	retrieve: (kind: "video", url: string, byteLimit?: number) => Promise<unknown>;
	execute: (command: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
}

interface VideoDeliveryDependencies extends VideoVerificationDependencies {
	byteLimit: number;
	candidates: (byteLimit: number, smallest?: boolean) => VideoCandidate[];
	compress?: typeof compressVideo;
}

const failures = new Set(["rate_limited", "login_or_restriction", "restricted", "access_denied", "gateway_denied", "unavailable", "timeout",
	"size_limit", "output_limit", "invalid_input", "invalid_image", "invalid_media", "redirect_denied", "extractor_error", "duration_limit", "audio_unverified"]);

export async function verifyVideo(media: VideoMedia, candidates: VideoCandidate[], dependencies: VideoVerificationDependencies): Promise<Record<string, unknown>> {
	if (media.kind === "image") return { outcome: "invalid_media" };
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
			// Only byte overflow permits another format; access and validation failures are terminal.
			if (error instanceof Error && error.message === "size_limit") continue;
			return { outcome: error instanceof Error && failures.has(error.message) ? error.message : "video_validation_failed" };
		}
	}
	return { outcome: "size_limit" };
}

/** Four downloads maximum per video, including one larger source only after a size failure. */
export async function prepareVideoAttachment(media: VideoMedia, dependencies: VideoDeliveryDependencies): Promise<Record<string, unknown>> {
	if (!Number.isSafeInteger(dependencies.byteLimit) || dependencies.byteLimit < 1_024 || dependencies.byteLimit > 8 * 1_024 * 1_024) return { outcome: "size_limit" };
	const { compressVideo, MAX_VIDEO_SOURCE_BYTES, videoCompressionPlan } = await import(new URL("./videoCompression.ts", import.meta.url).href) as typeof import("./videoCompression.js");
	// Silent animated GIFs keep original-only delivery; never invent or discard audio to compress them.
	const canCompress = media.kind === "video" && dependencies.byteLimit >= 64 * 1_024
		&& (!media.durationSeconds || Boolean(videoCompressionPlan(media.durationSeconds, dependencies.byteLimit)));
	let result = await verifyVideo(media, dependencies.candidates(dependencies.byteLimit).slice(0, canCompress ? 3 : 4), dependencies);
	if (canCompress && result.outcome === "size_limit") {
		const source = dependencies.candidates(MAX_VIDEO_SOURCE_BYTES, true).at(0);
		if (source) {
			result = await verifyVideo(media, [source], { ...dependencies, byteLimit: MAX_VIDEO_SOURCE_BYTES });
			if (result.outcome === "video_verified" && Number(result.bytes) > dependencies.byteLimit) {
				result = await (dependencies.compress ?? compressVideo)(dependencies.byteLimit);
			}
		}
	}
	return result;
}
