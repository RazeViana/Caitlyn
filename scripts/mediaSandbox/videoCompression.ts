/**
 * @file videoCompression.ts
 * @description Compresses a verified local MP4 to the upload budget inside the disposable sandbox.
 * Bounds input/output, CPU time and quality; never fetches URLs or accepts partial-length output.
 *
 * @module videoCompression
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename, stat } from "node:fs/promises";

export const MAX_VIDEO_SOURCE_BYTES = 48 * 1_024 * 1_024;
const input = "/tmp/x-video.mp4";
const output = "/tmp/compact-video.mp4";
const executeFile = promisify(execFile);

interface CompressionDependencies {
	execute: (command: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
	stat: (path: string) => Promise<{ size: number; isFile(): boolean }>;
	rename: (from: string, to: string) => Promise<void>;
}

/** A fixed quality floor prevents arbitrarily tiny output; longer clips may remain too large. */
export function videoCompressionPlan(duration: number, byteLimit: number): { videoRate: number; audioRate: number; side: number; fps: number } | undefined {
	if (!Number.isFinite(duration) || duration <= 0 || duration > 900 || !Number.isSafeInteger(byteLimit)
		|| byteLimit < 64 * 1_024 || byteLimit > 8 * 1_024 * 1_024) return;
	const totalRate = Math.floor(byteLimit * 8 * 0.85 / duration);
	const audioRate = totalRate >= 320_000 ? 64_000 : 32_000;
	const videoRate = Math.min(1_000_000, totalRate - audioRate);
	if (videoRate < 48_000) return;
	return { videoRate, audioRate, side: videoRate >= 400_000 ? 480 : videoRate >= 160_000 ? 360 : 240, fps: videoRate < 160_000 ? 15 : 24 };
}

function inspected(value: string): { duration: number; width: number; height: number; videoDuration: number; audioDuration: number } {
	const parsed = JSON.parse(value);
	const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
	const video = streams.filter((stream: { codec_type?: string }) => stream.codec_type === "video");
	const audio = streams.filter((stream: { codec_type?: string }) => stream.codec_type === "audio");
	const duration = Number(parsed.format?.duration);
	// Reject additional streams rather than silently dropping alternate audio/subtitles/data.
	if (streams.length !== 2 || video.length !== 1 || audio.length !== 1 || video[0].codec_name !== "h264" || audio[0].codec_name !== "aac"
		|| !Number.isSafeInteger(video[0].width) || !Number.isSafeInteger(video[0].height) || video[0].width <= 0 || video[0].height <= 0
		|| video[0].width * video[0].height > 2_073_600 || !Number.isFinite(duration) || duration <= 0 || duration > 900) throw new Error("video_validation_failed");
	const videoDuration = Number(video[0].duration);
	const audioDuration = Number(audio[0].duration);
	if (![videoDuration, audioDuration].every((length) => Number.isFinite(length) && length > 0 && Math.abs(duration - length) <= 0.5)) throw new Error("video_validation_failed");
	return { duration, width: video[0].width, height: video[0].height, videoDuration, audioDuration };
}

export async function compressVideo(byteLimit: number, dependencies: CompressionDependencies = {
	execute: (command, args, options) => executeFile(command, args, { ...options, killSignal: "SIGKILL" }), stat, rename,
}): Promise<{ outcome: "video_verified"; bytes: number; compressed: true } | { outcome: "size_limit" | "video_validation_failed" | "compression_timeout" | "compression_incomplete" }> {
	try {
		if (!Number.isSafeInteger(byteLimit) || byteLimit < 64 * 1_024 || byteLimit > 8 * 1_024 * 1_024) return { outcome: "size_limit" };
		const source = await dependencies.stat(input);
		if (!source.isFile() || !Number.isSafeInteger(source.size) || source.size <= 0 || source.size > MAX_VIDEO_SOURCE_BYTES) return { outcome: "size_limit" };
		const probe = async (path: string) => inspected((await dependencies.execute("ffprobe", ["-v", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe",
			"-show_entries", "stream=codec_type,codec_name,width,height,duration:format=duration", "-of", "json", path], { timeout: 5_000, maxBuffer: 32_768 })).stdout);
		const before = await probe(input);
		const plan = videoCompressionPlan(before.duration, byteLimit);
		if (!plan) return { outcome: "size_limit" };
		const base = ["-nostdin", "-y", "-v", "error", "-xerror", "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1",
			"-protocol_whitelist", "file,pipe", "-i", input, "-map", "0:v:0", "-map_metadata", "-1", "-map_chapters", "-1",
			"-vf", `fps=${plan.fps},scale=w='min(${plan.side},iw)':h='min(${plan.side},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`,
			"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-threads:v", "1", "-b:v", String(plan.videoRate),
			"-passlogfile", "/tmp/compact-video-pass"];
		await dependencies.execute("ffmpeg", [...base, "-pass", "1", "-an", "-f", "null", "/dev/null"], { timeout: 20_000, maxBuffer: 32_768 });
		// -fs is an emergency disk bound, NOT proof of completeness; duration and every frame are checked below.
		await dependencies.execute("ffmpeg", [...base, "-pass", "2", "-map", "0:a:0", "-c:a", "aac", "-b:a", String(plan.audioRate),
			"-ac", "2", "-movflags", "+faststart", "-fs", String(byteLimit), output], { timeout: 20_000, maxBuffer: 32_768 });
		const encoded = await dependencies.stat(output);
		if (!encoded.isFile() || !Number.isSafeInteger(encoded.size) || encoded.size <= 0 || encoded.size > byteLimit) return { outcome: "size_limit" };
		const after = await probe(output);
		if (after.width > plan.side || after.height > plan.side || ["duration", "videoDuration", "audioDuration"].some((key) =>
			Math.abs(after[key as keyof typeof after] - before[key as keyof typeof before]) > 0.25)) return { outcome: "compression_incomplete" };
		await dependencies.execute("ffmpeg", ["-nostdin", "-v", "error", "-xerror", "-threads", "1", "-protocol_whitelist", "file,pipe",
			"-i", output, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], { timeout: 10_000, maxBuffer: 32_768 });
		await dependencies.rename(output, input);
		return { outcome: "video_verified", bytes: encoded.size, compressed: true };
	}
	catch (error) { return { outcome: (error as { killed?: boolean })?.killed ? "compression_timeout" : "video_validation_failed" }; }
}
