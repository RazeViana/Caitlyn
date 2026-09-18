/**
 * @file instagramPostWorker.ts
 * @description Delivers public Instagram photos and ordered videos using shared sandbox verification and compression.
 * Provider URLs stay on private stdin; terminal access failures stop the rest of a carousel.
 *
 * @module instagramPostWorker
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { normalizeInstagramPost } from "../../core/socialInstagramPost.js";
import type { compressVideo } from "./videoCompression.js";

const execute = promisify(execFile);
const failures = new Set(["invalid_input", "output_limit", "redirect_denied", "restricted", "size_limit", "invalid_media", "access_denied", "unavailable", "rate_limited", "timeout", "extractor_error"]);
const metadataFailures: Record<string, string> = { http_401: "restricted", http_403: "access_denied", http_404: "unavailable", http_429: "rate_limited",
	http_redirect: "redirect_denied", page_metadata_missing: "unavailable", page_restricted: "restricted", login_required: "restricted", query_failed: "unavailable" };

async function retrieve(kind: "metadata" | "image" | "video", value: string, byteLimit?: number): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const child = execFile("/opt/extractor/bin/python", ["-B", "/opt/probe/instagramMedia.py", kind, ...(byteLimit ? [String(byteLimit)] : [])],
			{ timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 1_100_000 }, (error, stdout) => {
				try {
					const result = JSON.parse(stdout);
					if (error || result.failure) {
						const reason = typeof result.failure === "string" && Object.hasOwn(metadataFailures, result.failure) ? result.failure : undefined;
						reject(new Error(reason ? metadataFailures[reason] : failures.has(result.failure) ? result.failure : "extractor_error", { cause: kind === "metadata" ? reason : undefined }));
					}
					else { resolve(result); }
				}
				catch { reject(new Error(error?.killed ? "timeout" : "extractor_error")); }
			});
		child.stdin?.on("error", () => {
			// Completion handles closed input without exposing provider data.
		});
		child.stdin?.end(value);
	});
}

interface InstagramDependencies {
	retrieve: typeof retrieve;
	execute: (command: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string }>;
	readFile: (path: string) => Promise<Buffer>;
	normalize: typeof normalizeInstagramPost;
	compress?: typeof compressVideo;
}

export async function deliverInstagramPost(url: string, attachmentBytes: number, totalBytes: number, injected?: InstagramDependencies): Promise<unknown> {
	if (!/^https:\/\/www\.instagram\.com\/(?:p|reel)\/[a-zA-Z0-9_-]{1,28}\/$/.test(url)
		|| !Number.isSafeInteger(attachmentBytes) || attachmentBytes < 1_024 || attachmentBytes > 8 * 1_024 * 1_024
		|| !Number.isSafeInteger(totalBytes) || totalBytes < attachmentBytes || totalBytes > 20 * 1_024 * 1_024) return { outcome: "invalid_response" };
	try {
		const { verifyImage } = await import(new URL("./xPostWorker.ts", import.meta.url).href) as typeof import("./xPostWorker.js");
		const { prepareVideoAttachment } = await import(new URL("./videoDelivery.ts", import.meta.url).href) as typeof import("./videoDelivery.js");
		const adapter = injected ? undefined : await import(new URL("./socialInstagramPost.ts", import.meta.url).href) as typeof import("../../core/socialInstagramPost.js");
		const dependencies = injected ?? { retrieve, execute, readFile, normalize: adapter!.normalizeInstagramPost };
		const result = dependencies.normalize(await dependencies.retrieve("metadata", url), url);
		if (!("post" in result)) return result;
		const files = [];
		const mediaFailures: string[] = [];
		let remaining = totalBytes;
		let halted = false;
		for (const media of result.post.media) {
			const byteLimit = Math.min(attachmentBytes, remaining);
			if (halted || byteLimit < 1_024) {
				mediaFailures.push(halted ? "not_attempted" : "size_limit");
				continue;
			}
			if ((media.kind === "image" && !media.imageUrl) || (media.kind !== "image" && !media.variants.length)) {
				mediaFailures.push("invalid_media");
				continue;
			}
			const verified = media.kind === "image" ? await verifyImage(media, { ...dependencies, byteLimit })
				: await prepareVideoAttachment(media, { ...dependencies, byteLimit, candidates: (_limit, smallest) => smallest
					? [...media.variants].reverse().slice(0, 4) : media.variants.slice(0, 4) });
			if (!["image_verified", "video_verified"].includes(String(verified.outcome))) {
				mediaFailures.push(String(verified.outcome));
				halted = ["rate_limited", "restricted", "access_denied", "gateway_denied", "redirect_denied", "timeout"].includes(String(verified.outcome));
				continue;
			}
			const data = await dependencies.readFile(media.kind === "image" ? "/tmp/x-image.bin" : "/tmp/x-video.mp4");
			if (!data.length || data.length !== verified.bytes || data.length > byteLimit) return { outcome: "invalid_response" };
			remaining -= data.length;
			const extension = media.kind !== "image" ? "mp4" : verified.mime === "image/png" ? "png" : verified.mime === "image/webp" ? "webp" : "jpg";
			files.push({ postId: result.post.id, mediaId: media.id, extension, base64: data.toString("base64"), sha256: createHash("sha256").update(data).digest("hex"),
				...(verified.compressed === true ? { compressed: true } : {}) });
		}
		return { version: 1, outcome: mediaFailures.length ? "partial" : result.outcome, post: result.post, files, mediaFailures };
	}
	catch (error) {
		const reason = error instanceof Error ? error.message : "";
		const detail = error instanceof Error && typeof error.cause === "string" && Object.hasOwn(metadataFailures, error.cause) ? error.cause : undefined;
		return { ...(detail ? { instagramReason: detail } : {}), outcome: ["restricted", "access_denied", "redirect_denied"].includes(reason) ? "restricted"
			: ["unavailable", "rate_limited", "timeout"].includes(reason) ? reason
				: ["invalid_input", "output_limit"].includes(reason) ? "invalid_response" : "worker_unavailable" };
	}
}
