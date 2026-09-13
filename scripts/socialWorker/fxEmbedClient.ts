/**
 * @file fxEmbedClient.ts
 * @description Fetches bounded metadata only from the operator's local FxEmbed service.
 * Rejects redirects and remote origins; never sends bot credentials or logs response bodies.
 *
 * @module fxEmbedClient
 */

import { request } from "node:http";
import type { SocialWorkerFailure } from "../../types/socialDelivery.js";

export const FX_METADATA_LIMIT = 1024 * 1024;
export const FX_HOST = "caitlyn-fxembed.invalid";

export function createFxEmbedClient(origin = "http://127.0.0.1:8787", timeoutMs = 30_000, apiKey?: string) {
	if (apiKey !== undefined && !/^[a-f0-9]{64}$/.test(apiKey)) throw new Error("invalid_fxembed_api_key");
	if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/.test(origin) || Number(new URL(origin).port) > 65535
		|| !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error("fxembed_requires_loopback_origin");
	return async (postId: string, signal: AbortSignal): Promise<{ outcome: "received"; payload: unknown } | SocialWorkerFailure> => {
		if (typeof postId !== "string" || !/^[1-9]\d{0,24}$/.test(postId)) return { outcome: "invalid_response" };
		if (signal.aborted) return { outcome: "timeout" };
		return new Promise((resolve) => {
			let settled = false;
			const finish = (value: { outcome: "received"; payload: unknown } | SocialWorkerFailure): void => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				resolve(value);
				op.destroy();
			};
			const op = request(new URL("/2/status/" + postId, origin), {
				method: "GET", headers: { Host: FX_HOST, Accept: "application/json", "User-Agent": "Caitlyn/3.0 local FxEmbed integration",
					...(apiKey ? { "x-caitlyn-key": apiKey } : {}) },
			}, (response) => {
				const status = response.statusCode ?? 0;
				if (status !== 200) {
					finish({ outcome: status === 401 || status === 403 ? "restricted" : status === 404 ? "unavailable"
						: status === 429 ? "rate_limited" : status >= 500 ? "worker_unavailable" : "invalid_response" });
					return;
				}
				if (!/^application\/json(?:;|$)/i.test(response.headers["content-type"] ?? "")
					|| Number(response.headers["content-length"]) > FX_METADATA_LIMIT) {
					finish({ outcome: "invalid_response" });
					return;
				}
				const chunks: Buffer[] = [];
				let size = 0;
				response.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > FX_METADATA_LIMIT) finish({ outcome: "invalid_response" });
					else chunks.push(chunk);
				});
				response.on("error", () => { finish({ outcome: "worker_unavailable" }); });
				response.on("end", () => {
					try { finish({ outcome: "received", payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
					catch { finish({ outcome: "invalid_response" }); }
				});
			});
			const abort = (): void => { finish({ outcome: "timeout" }); };
			const timer = setTimeout(abort, timeoutMs);
			signal.addEventListener("abort", abort, { once: true });
			op.on("error", () => { finish({ outcome: signal.aborted ? "timeout" : "worker_unavailable" }); });
			op.end();
		});
	};
}
