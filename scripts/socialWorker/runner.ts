/**
 * @file runner.ts
 * @description Routes X through local FxEmbed and TikTok/Instagram through isolated public extractors, then verifies media.
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
import { jobLabels, recoverDockerResources, workerOwner, type DockerCommand } from "./dockerResources.js";

const execute = promisify(execFile);
const restrictions = ["--pull=never", "--rm", "--init", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=1000:1000", "--log-driver=none"];

export function workerFailureReason(error: unknown): string {
	const known = ["worker_cleanup_required", "worker_requires_local_docker", "worker_image_unavailable", "invalid_worker_context",
		"invalid_x_metadata_provider", "invalid_worker_socket", "worker_socket_directory_must_be_private", "worker_socket_already_exists",
		"worker_docker_timeout", "worker_docker_failed"];
	return error instanceof Error && known.includes(error.message) ? error.message : "worker_operation_failed";
}

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

export async function createDockerSocialRunner(context: string, imageReference: string, selectedProvider: string = "fxembed", origin?: string, apiKeyFile?: string,
	options: { socketPath?: string; docker?: DockerCommand; fetchMetadata?: ReturnType<typeof createFxEmbedClient> } = {}) {
	const provider = parseXMetadataProvider(selectedProvider);
	let fetchMetadata: ReturnType<typeof createFxEmbedClient> | undefined;
	try { fetchMetadata = options.fetchMetadata ?? createFxEmbedClient(origin, 30_000, apiKeyFile ? await readLocalApiKey(apiKeyFile) : undefined); }
	catch { logger.warn("X metadata configuration unavailable; TikTok and Instagram remain independent", "check=SOCIAL_FXEMBED_URL,SOCIAL_FXEMBED_KEY_FILE"); }
	if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(context)) throw new Error("invalid_worker_context");
	const owner = await workerOwner(options.socketPath ?? process.env.SOCIAL_WORKER_SOCKET ?? "", context);
	const docker: DockerCommand = options.docker ?? (async (args, timeout = 30_000, signal, stdin) => {
		if (stdin !== undefined) {
			return new Promise((resolve, reject) => {
				const child = execFile("docker", ["--context", context, ...args], { timeout, killSignal: "SIGKILL", signal, maxBuffer: SOCIAL_WIRE_LIMIT },
					(error, stdout) => { if (error) reject(new Error(error.killed ? "worker_docker_timeout" : "worker_docker_failed")); else resolve(stdout.trim()); });
				child.stdin?.on("error", () => {
					// Process completion handles a closed input pipe.
				});
				child.stdin?.end(stdin);
			});
		}
		try {
			const result = await execute("docker", ["--context", context, ...args], { timeout, killSignal: "SIGKILL", signal, maxBuffer: SOCIAL_WIRE_LIMIT });
			return result.stdout.trim();
		}
		catch (error) { throw new Error((error as { killed?: boolean }).killed ? "worker_docker_timeout" : "worker_docker_failed", { cause: error }); }
	});
	const endpoint = JSON.parse(await docker(["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"]));
	if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///")) throw new Error("worker_requires_local_docker");
	const recovered = await recoverDockerResources(docker, owner);
	if (recovered.containers || recovered.volumes) logger.info("Recovered this broker's temporary media workers", `containers=${recovered.containers}`, `volumes=${recovered.volumes}`);
	// Legacy or foreign resources lack this private instance's ownership proof and still need operator review.
	const leftoverContainers = await docker(["ps", "-aq", "--filter=label=dev.caitlyn.social-worker=true"]);
	const leftoverVolumes = await docker(["volume", "ls", "-q", "--filter=label=dev.caitlyn.social-worker=true"]);
	if (leftoverContainers || leftoverVolumes) throw new Error("worker_cleanup_required");
	// Resolve the operator's installed image once; never pull or accept an image from a request.
	const image = await docker(["image", "inspect", imageReference, "--format", "{{.Id}}"]);
	if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("worker_image_unavailable");
	let cleanupBlocked = false;
	const run = async (input: SocialWorkerRequest, signal: AbortSignal, operation: SocialWorkerOperation = "delivery"): Promise<unknown> => {
		const started = Date.now();
		validateSocialWorkerRequest(input);
		const platform = parseSocialLink(input.url)!.platform;
		if (platform !== "x" && operation !== "delivery") throw new Error("invalid_worker_operation");
		const args = platform !== "x" ? [`--deliver-${platform}`, input.url, String(input.attachmentBytes), String(input.totalBytes)] : xWorkerArguments(input, provider, operation);
		const result = (value: Record<string, unknown>): Record<string, unknown> => ({ ...value, version: 1, purpose: operation, provider: platform === "x" ? provider : platform });
		if (signal.aborted) return result({ outcome: "timeout" });
		let encoded = "";
		if (platform === "x") {
			if (!fetchMetadata) return result({ outcome: "worker_unavailable" });
			const postId = input.url.split("/").at(-1)!;
			const fetched = await fetchMetadata(postId, signal);
			if (fetched.outcome !== "received") return result(fetched);
			const metadata = normalizeFxPost(fetched.payload, postId, input.allowSensitive);
			if (operation === "metadata" || !("post" in metadata)) return result(metadata);
			if (!metadata.post.media.length && !(metadata.post.quote?.state === "available" && metadata.post.quote.post.media.length)) {
				logger.info("Social text preview prepared without a media worker", `platform=${platform}`, `elapsed_ms=${Date.now() - started}`);
				return result({ ...metadata, files: [] });
			}
			encoded = JSON.stringify(fetched.payload);
			if (Buffer.byteLength(encoded) > FX_METADATA_LIMIT) return result({ outcome: "invalid_response" });
		}
		const job = randomUUID();
		const prefix = `caitlyn-social-${job}`;
		const labels = jobLabels(owner, job);
		const volume = `${prefix}-ipc`;
		const gateway = `${prefix}-gateway`;
		const worker = `${prefix}-worker`;
		let stage = "recovery";
		try {
			await recoverDockerResources(docker, owner);
			cleanupBlocked = false;
			if (signal.aborted) return result({ outcome: "timeout" });
			stage = "gateway_start";
			await docker(["volume", "create", ...labels, volume]);
			if (signal.aborted) return result({ outcome: "timeout" });
			await docker(["run", "-d", "--name", gateway, ...labels, ...restrictions,
				"--memory=96m", "--memory-swap=96m", "--cpus=0.25", "--pids-limit=32", "--mount", `type=volume,source=${volume},target=/ipc`,
				image, "timeout", "-s", "KILL", "120", "node", "/opt/probe/gateway.ts", platform]);
			stage = "gateway_ready";
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
			const sandboxOptions = [...restrictions, "--network=none", "--memory=512m", "--memory-swap=512m", "--cpus=1", "--pids-limit=64",
				"--tmpfs", "/tmp:size=96m,mode=1777,nosuid,noexec", "--mount", `type=volume,source=${volume},target=/ipc,readonly`];
			stage = "media_delivery";
			logger.info("Social media sandbox ready", `platform=${platform}`, `elapsed_ms=${Date.now() - started}`);
			// The delivering process verifies its own isolation before reading metadata or downloading media.
			const output = await docker(["run", "-i", "--name", worker, ...labels, ...sandboxOptions,
				image, "timeout", "-s", "KILL", "90", "node", "/opt/probe/worker.ts", "--checked-delivery", ...args], 100_000, signal, encoded);
			logger.info("Social media verified", `platform=${platform}`, `elapsed_ms=${Date.now() - started}`);
			return result(JSON.parse(output));
		}
		catch (error) {
			logger.warn("Social media worker could not finish", `platform=${platform}`, `stage=${stage}`, `reason=${workerFailureReason(error)}`, `elapsed_ms=${Date.now() - started}`);
			return result({ outcome: signal.aborted ? "timeout" : "worker_unavailable" });
		}
		finally {
			// Failed cleanup is retried on the next job/startup, including resources Docker creates late.
			cleanupBlocked = true;
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					await recoverDockerResources(docker, owner);
					cleanupBlocked = false;
					break;
				}
				catch { if (!attempt) await new Promise((resolve) => setTimeout(resolve, 250)); }
			}
			if (cleanupBlocked) logger.error("Social worker cleanup pending; this broker will retry its own temporary resources before the next media job");
			logger.info("Social media job finished", `platform=${platform}`, `elapsed_ms=${Date.now() - started}`, `cleanup=${cleanupBlocked ? "pending" : "complete"}`);
		}
	};
	return Object.assign(run, { healthy: () => !cleanupBlocked });
}
