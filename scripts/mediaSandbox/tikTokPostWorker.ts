/**
 * @file tikTokPostWorker.ts
 * @description Extracts TikTok video metadata and verifies bounded MP4 attachments inside the sandbox.
 * Keeps signed CDN URLs on private process input and reports only closed failure categories.
 *
 * @module tikTokPostWorker
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { normalizeTikTokPost, tikTokVideoCandidates } from "../../core/socialTikTokPost.js";
import type { compressVideo } from "./videoCompression.js";

const execute = promisify(execFile);
const failures = new Set(["invalid_input", "output_limit", "redirect_denied", "unsupported", "restricted", "size_limit", "invalid_media",
	"gateway_denied", "rate_limited", "access_denied", "unavailable", "timeout", "extractor_error"]);

async function retrieve(kind: "metadata" | "video", value: string, byteLimit?: number): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = execFile("/opt/extractor/bin/python", ["/opt/probe/tikTokMedia.py", kind, ...(byteLimit ? [String(byteLimit)] : [])],
			{ timeout: kind === "metadata" ? 45_000 : 20_000, killSignal: "SIGKILL", maxBuffer: 1_100_000 }, (error, stdout) => {
				try {
					const result = JSON.parse(stdout);
					if (error || result.failure) {
						reject(new Error(failures.has(result.failure) ? result.failure : "extractor_error"));
					}
					else { resolve(result); }
				}
				catch { reject(new Error(error?.killed ? "timeout" : "extractor_error")); }
			});
		child.stdin?.on("error", () => {
			// Completion classifies closed input without raw errors.
		});
		child.stdin?.end(value);
	});
}

interface TikTokDependencies {
	retrieve: typeof retrieve;
	execute: (command: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
	readFile: (path: string) => Promise<Buffer>;
	normalize: typeof normalizeTikTokPost;
	candidates: typeof tikTokVideoCandidates;
	compress?: typeof compressVideo;
}

export async function deliverTikTokPost(url: string, attachmentBytes: number, totalBytes: number, injected?: TikTokDependencies): Promise<unknown> {
	const postId = url.match(/^https:\/\/www\.tiktok\.com\/@[a-z0-9_.]{1,32}\/video\/([1-9]\d{0,24})$/i)?.[1];
	const share = /^https:\/\/(?:(?:vm|vt)\.tiktok\.com\/|www\.tiktok\.com\/t\/)[a-z0-9]{1,64}\/$/i.test(url);
	if ((!postId && !share) || !Number.isSafeInteger(attachmentBytes) || attachmentBytes < 1_024 || attachmentBytes > 8 * 1_024 * 1_024
		|| !Number.isSafeInteger(totalBytes) || totalBytes < attachmentBytes || totalBytes > 20 * 1_024 * 1_024) return { outcome: "invalid_response" };
	try {
		const { prepareVideoAttachment } = await import(new URL("./videoDelivery.ts", import.meta.url).href) as typeof import("./videoDelivery.js");
		const adapter = injected ? undefined : await import(new URL("./socialTikTokPost.ts", import.meta.url).href) as typeof import("../../core/socialTikTokPost.js");
		const dependencies: TikTokDependencies = injected ?? { retrieve, execute, readFile, normalize: adapter!.normalizeTikTokPost, candidates: adapter!.tikTokVideoCandidates };
		const result = dependencies.normalize(await dependencies.retrieve("metadata", url), postId);
		if (!("post" in result)) return result;
		const media = result.post.media[0];
		const verified = await prepareVideoAttachment(media, { ...dependencies, byteLimit: attachmentBytes,
			retrieve: async (_kind, candidate, limit) => dependencies.retrieve("video", candidate, limit),
			candidates: (limit, smallest) => dependencies.candidates(media, limit, smallest) });
		if (verified.outcome !== "video_verified") {
			return { version: 1, outcome: "partial", post: result.post, files: [], mediaFailures: [verified.outcome] };
		}
		const data = await dependencies.readFile("/tmp/x-video.mp4");
		if (!data.length || data.length > attachmentBytes || data.length !== verified.bytes) return { outcome: "invalid_response" };
		return { version: 1, outcome: result.outcome, post: result.post,
			files: [{ postId: result.post.id, mediaId: media.id, extension: "mp4", base64: data.toString("base64"), sha256: createHash("sha256").update(data).digest("hex"),
				...(verified.compressed === true ? { compressed: true } : {}) }], mediaFailures: [] };
	}
	catch (error) {
		const reason = error instanceof Error ? error.message : "";
		return { outcome: ["restricted", "access_denied"].includes(reason) ? "restricted" : ["unsupported", "unavailable", "rate_limited", "timeout"].includes(reason) ? reason
			: ["invalid_input", "output_limit", "redirect_denied"].includes(reason) ? "invalid_response" : "worker_unavailable" };
	}
}
