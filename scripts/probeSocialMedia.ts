/**
 * @file probeSocialMedia.ts
 * @description Runs explicit, bounded metadata-only probes against official oEmbed endpoints.
 * Never downloads media, executes returned HTML, uses account credentials, or contacts Discord.
 *
 * @module probeSocialMedia
 */

import { pathToFileURL } from "node:url";
import logger from "../core/logger.js";
import { parseSocialLink } from "../core/socialLinks.js";
import type { SocialPlatform } from "../types/socialMedia.js";

const MAX_RESPONSE_BYTES = 256 * 1_024;
const MAX_PROBES = 10;

interface ProbeResult {
	platform?: SocialPlatform;
	key?: string;
	outcome: "metadata" | "invalid_link" | "needs_resolution" | "approval_required"
		| "http_error" | "timeout" | "network_error" | "invalid_response" | "response_too_large";
	status?: number;
	bytes?: number;
	fields?: { author: boolean; title: boolean; html: boolean; thumbnail: boolean };
	mediaDownloadTested: false;
}

/**
 * The request destination is a fixed provider endpoint, never the supplied post or CDN URL.
 * This diagnostic is not the future media fetcher: redirects and returned URLs are not followed.
 */
export async function probeSocialMedia(input: string, options: {
	fetch?: typeof fetch;
	timeoutMs?: number;
} = {}): Promise<ProbeResult> {
	const link = parseSocialLink(input);
	const base = { platform: link?.platform, key: link?.key, mediaDownloadTested: false as const };
	if (!link) return { ...base, outcome: "invalid_link" };
	if (link.kind === "share") return { ...base, outcome: "needs_resolution" };
	// Reddit requires explicit approval. Do not try .json, alternate hosts, or anonymous fallbacks.
	if (link.platform === "reddit") return { ...base, outcome: "approval_required" };

	const endpoints = {
		x: "https://publish.x.com/oembed",
		instagram: "https://graph.facebook.com/v25.0/instagram_oembed",
		tiktok: "https://www.tiktok.com/oembed",
	};
	const endpoint = new URL(endpoints[link.platform]);
	endpoint.searchParams.set("url", link.url);
	if (link.platform === "x") {
		endpoint.searchParams.set("omit_script", "true");
		endpoint.searchParams.set("dnt", "true");
	}
	const timeoutMs = options.timeoutMs ?? 8_000;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) {
		throw new RangeError("Probe deadline must be between 1 and 20000 milliseconds");
	}
	const controller = new AbortController();
	const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let status: number | undefined;
	try {
		const response = await (options.fetch ?? fetch)(endpoint, {
			signal: controller.signal,
			redirect: "manual",
			credentials: "omit",
			headers: { Accept: "application/json", "User-Agent": "Caitlyn-Social-Feasibility/1.0 (+https://github.com/RazeViana/Caitlyn)" },
		});
		status = response.status;
		if (!response.ok) return { ...base, outcome: "http_error", status };
		if (!response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) {
			return { ...base, outcome: "invalid_response", status };
		}
		if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
			return { ...base, outcome: "response_too_large", status };
		}
		reader = response.body.getReader();
		let bytes = 0;
		const chunks: Uint8Array[] = [];
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > MAX_RESPONSE_BYTES) return { ...base, outcome: "response_too_large", status };
			chunks.push(chunk.value);
		}
		let data: unknown;
		try {
			data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		}
		catch {
			return { ...base, outcome: "invalid_response", status, bytes };
		}
		if (!data || typeof data !== "object" || Array.isArray(data)) return { ...base, outcome: "invalid_response", status, bytes };
		const record = data as Record<string, unknown>;
		const hasText = (field: string): boolean => typeof record[field] === "string" && record[field].trim().length > 0;
		if (record.error || !["rich", "video"].includes(String(record.type)) || !hasText("html")) {
			return { ...base, outcome: "invalid_response", status, bytes };
		}
		return {
			...base, outcome: "metadata", status, bytes,
			fields: { author: hasText("author_name"), title: hasText("title"), html: hasText("html"), thumbnail: hasText("thumbnail_url") },
		};
	}
	catch {
		// Error messages/bodies can contain signed URLs or tokens; publish only stable categories.
		return { ...base, outcome: controller.signal.aborted ? "timeout" : "network_error", status };
	}
	finally {
		controller.abort();
		clearTimeout(timer);
		if (reader) {
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
		}
	}
}

export async function runSocialProbes(inputs: string[]): Promise<number> {
	if (inputs.length === 0 || inputs.length > MAX_PROBES) {
		logger.error("Usage: node --import tsx scripts/probeSocialMedia.ts <1-10 public post URLs>");
		return 2;
	}
	let incomplete = false;
	const seen = new Set<string>();
	for (const input of inputs) {
		const key = parseSocialLink(input)?.key;
		if (key && seen.has(key)) continue;
		if (key) seen.add(key);
		const result = await probeSocialMedia(input);
		if (result.outcome === "metadata") {
			logger.info("Social metadata probe", JSON.stringify(result));
		}
		else {
			incomplete = true;
			logger.warn("Social metadata probe", JSON.stringify(result));
		}
	}
	return incomplete ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await runSocialProbes(process.argv.slice(2));
}
