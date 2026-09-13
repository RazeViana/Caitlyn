/**
 * @file runner.ts
 * @description Routes X through local FxEmbed and TikTok through its isolated extractor, then verifies media.
 * Only the trusted host broker can use Docker; bounded metadata travels via stdin without host secrets or mounts.
 *
 * @module socialWorkerRunner
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { SOCIAL_WIRE_LIMIT, validateSocialWorkerRequest } from "../../core/socialWorkerClient.js";
import type { SocialWorkerOperation, SocialWorkerRequest } from "../../types/socialDelivery.js";
import type { XMetadataProvider } from "../../types/socialMedia.js";
import logger from "../../core/logger.js";
import { createFxEmbedClient, FX_METADATA_LIMIT } from "./fxEmbedClient.js";
import { normalizeFxPost } from "../../core/socialFxPost.js";
import { readLocalApiKey } from "../fxEmbed/localAccess.js";
import { parseSocialLink } from "../../core/socialLinks.js";

const execute = promisify(execFile);
const restrictions = ["--pull=never", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=1000:1000", "--log-driver=none"];

export function parseXMetadataProvider(value: unknown): XMetadataProvider {
	if (value === undefined || value === "fxembed") return "fxembed";
	throw new Error("invalid_x_metadata_provider");
}

/** Routes are selected by the broker, never by untrusted request-body flags or shell fragments. */
export function xWorkerArguments(input: SocialWorkerRequest, provider: XMetadataProvider, operation: SocialWorkerOperation): string[] {
	validateSocialWorkerRequest(input);
	if (parseSocialLink(input.url)?.platform !== "x") throw new Error("invalid_x_worker_request");
	parseXMetadataProvider(provider);
	if (operation === "metadata") return [];
	if (operation !== "delivery") throw new Error("invalid_worker_operation");
	return ["--deliver-x", input.url, String(input.attachmentBytes), String(input.totalBytes), input.allowSensitive === true ? "sensitive" : "standard", provider];
}

export async function createDockerSocialRunner(context: string, imageReference: string, selectedProvider: string = "fxembed", origin?: string, apiKeyFile?: string) {
	const provider = parseXMetadataProvider(selectedProvider);
	let fetchMetadata: ReturnType<typeof createFxEmbedClient> | undefined;
	try { fetchMetadata = createFxEmbedClient(origin, 30_000, apiKeyFile ? await readLocalApiKey(apiKeyFile) : undefined); }
	catch { logger.warn("X metadata configuration unavailable; TikTok remains independent", "check=SOCIAL_FXEMBED_URL,SOCIAL_FXEMBED_KEY_FILE"); }
	if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(context)) throw new Error("invalid_worker_context");
	async function docker(args: string[], timeout = 10_000, signal?: AbortSignal, stdin?: string): Promise<string> {
		if (stdin !== undefined) {
			return new Promise((resolve, reject) => {
				const child = execFile("docker", ["--context", context, ...args], { timeout, killSignal: "SIGKILL", signal, maxBuffer: SOCIAL_WIRE_LIMIT },
					(error, stdout) => { if (error) reject(new Error("worker_process_failed")); else resolve(stdout.trim()); });
				child.stdin?.on("error", () => {
					// Process completion handles a closed input pipe.
				});
				child.stdin?.end(stdin);
			});
		}
		const result = await execute("docker", ["--context", context, ...args], { timeout, killSignal: "SIGKILL", signal, maxBuffer: SOCIAL_WIRE_LIMIT });
		return result.stdout.trim();
	}
	const endpoint = JSON.parse(await docker(["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"]));
	if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///")) throw new Error("worker_requires_local_docker");
	// A crashed broker can leave resources behind. Refuse new work until the operator reviews them.
	const leftoverContainers = await docker(["ps", "-aq", "--filter=label=dev.caitlyn.social-worker=true"]);
	const leftoverVolumes = await docker(["volume", "ls", "-q", "--filter=label=dev.caitlyn.social-worker=true"]);
	if (leftoverContainers || leftoverVolumes) throw new Error("worker_cleanup_required");
	// Resolve the operator's installed image once; never pull or accept an image from a request.
	const image = await docker(["image", "inspect", imageReference, "--format", "{{.Id}}"]);
	if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("worker_image_unavailable");
	let cleanupBlocked = false;
	return async (input: SocialWorkerRequest, signal: AbortSignal, operation: SocialWorkerOperation = "delivery"): Promise<unknown> => {
		validateSocialWorkerRequest(input);
		const tikTok = parseSocialLink(input.url)?.platform === "tiktok";
		if (tikTok && operation !== "delivery") throw new Error("invalid_worker_operation");
		const args = tikTok ? ["--deliver-tiktok", input.url, String(input.attachmentBytes), String(input.totalBytes)] : xWorkerArguments(input, provider, operation);
		const result = (value: Record<string, unknown>): Record<string, unknown> => ({ ...value, version: 1, purpose: operation, provider: tikTok ? "tiktok" : provider });
		if (cleanupBlocked) return result({ outcome: "worker_unavailable" });
		let encoded = "";
		if (!tikTok) {
			if (!fetchMetadata) return result({ outcome: "worker_unavailable" });
			const postId = input.url.split("/").at(-1)!;
			const fetched = await fetchMetadata(postId, signal);
			if (fetched.outcome !== "received") return result(fetched);
			const metadata = normalizeFxPost(fetched.payload, postId, input.allowSensitive);
			if (operation === "metadata" || !("post" in metadata)) return result(metadata);
			encoded = JSON.stringify(fetched.payload);
			if (Buffer.byteLength(encoded) > FX_METADATA_LIMIT) return result({ outcome: "invalid_response" });
		}
		const prefix = `caitlyn-social-${randomUUID()}`;
		const volume = `${prefix}-ipc`;
		const gateway = `${prefix}-gateway`;
		const verifier = `${prefix}-verifier`;
		const worker = `${prefix}-worker`;
		const containers: string[] = [];
		let volumeCreated = false;
		try {
			if (signal.aborted) return result({ outcome: "timeout" });
			volumeCreated = true;
			await docker(["volume", "create", "--label=dev.caitlyn.social-worker=true", volume]);
			containers.push(gateway);
			await docker(["run", "-d", "--name", gateway, "--label=dev.caitlyn.social-worker=true", ...restrictions,
				"--memory=96m", "--memory-swap=96m", "--cpus=0.25", "--pids-limit=32", "--mount", `type=volume,source=${volume},target=/ipc`,
				image, "timeout", "-s", "KILL", "120", "node", "/opt/probe/gateway.ts", tikTok ? "tiktok" : "x"]);
			let ready = false;
			for (let attempt = 0; attempt < 30 && !signal.aborted; attempt++) {
				try {
					await docker(["exec", gateway, "test", "-S", "/ipc/proxy.sock"]);
					ready = true;
					break;
				}
				catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
			}
			if (!ready) return result({ outcome: "worker_unavailable" });
			const options = [...restrictions, "--network=none", "--memory=512m", "--memory-swap=512m", "--cpus=1", "--pids-limit=64",
				"--tmpfs", "/tmp:size=96m,mode=1777,nosuid,noexec", "--mount", `type=volume,source=${volume},target=/ipc,readonly`];
			containers.push(verifier);
			const checked = JSON.parse(await docker(["run", "--name", verifier, "--label=dev.caitlyn.social-worker=true", ...options,
				image, "node", "/opt/probe/worker.ts", "--isolation-check", "--self-hosted"], 15_000, signal));
			if (checked.passed !== true || checked.isolation?.gatewayRejectsHostedMetadata !== true) {
				return result({ outcome: "worker_unavailable" });
			}
			containers.push(worker);
			const output = await docker(["run", "-i", "--name", worker, "--label=dev.caitlyn.social-worker=true", ...options,
				image, "timeout", "-s", "KILL", "90", "node", "/opt/probe/worker.ts", ...args], 100_000, signal, encoded);
			return result(JSON.parse(output));
		}
		catch { return result({ outcome: signal.aborted ? "timeout" : "worker_unavailable" }); }
		finally {
			let failed = false;
			for (const container of containers.reverse()) {
				await docker(["rm", "--force", container]).catch(() => {
					failed = true;
					logger.error("Social worker container cleanup needs attention", container);
				});
			}
			if (volumeCreated) {
				await docker(["volume", "rm", volume]).catch(() => {
					failed = true;
					logger.error("Social worker volume cleanup needs attention", volume);
				});
			}
			if (failed) cleanupBlocked = true;
		}
	};
}
