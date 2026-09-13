/**
 * @file server.ts
 * @description Exposes Caitlyn's private metadata, verified-media delivery, and liveness API over an owner-only Unix socket.
 * Never opens a TCP listener or accepts Docker options, filesystem paths, credentials, or arbitrary platforms.
 *
 * @module socialWorkerServer
 */

import { chmod, lstat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeSocialMetadataResult, SOCIAL_FILE_LIMIT, SOCIAL_METADATA_LIMIT, SOCIAL_TOTAL_LIMIT, SOCIAL_WIRE_LIMIT, validateSocialMetadataRequest, validateSocialWorkerRequest } from "../../core/socialWorkerClient.js";
import type { SocialWorkerOperation, SocialWorkerRequest } from "../../types/socialDelivery.js";
import type { XMetadataProvider } from "../../types/socialMedia.js";
import { createDockerSocialRunner, parseXMetadataProvider } from "./runner.js";
import logger from "../../core/logger.js";

export async function startSocialWorkerServer(socketPath: string, run: (input: SocialWorkerRequest, signal: AbortSignal, operation?: SocialWorkerOperation) => Promise<unknown>, options: { provider?: XMetadataProvider } = {}) {
	const provider = parseXMetadataProvider(options.provider);
	if (!socketPath.startsWith("/") || Buffer.byteLength(socketPath) > 100 || /[\p{Cc}]/u.test(socketPath)) throw new Error("invalid_worker_socket");
	const parent = await lstat(dirname(socketPath));
	if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0) throw new Error("worker_socket_directory_must_be_private");
	let busy = false;
	let stopping = false;
	let active: AbortController | undefined;
	let activeWork: Promise<unknown> | undefined;
	const server = createServer({ maxHeaderSize: 4_096 }, (request, response) => {
		const operation = request.url === "/v1/x/metadata" ? "metadata" : "delivery";
		const reply = (status: number, result: unknown): void => {
			const body = JSON.stringify(result);
			if (Buffer.byteLength(body) > (operation === "metadata" ? SOCIAL_METADATA_LIMIT : SOCIAL_WIRE_LIMIT)) {
				response.writeHead(502, { "Content-Type": "application/json" });
				response.end("{\"outcome\":\"invalid_response\"}");
				return;
			}
			response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
			response.end(body);
		};
		if (request.method === "GET" && request.url === "/v1/health") {
			// Liveness only: never probe X, Docker, the database, or Discord on a health request.
			request.resume();
			reply(stopping ? 503 : 200, { version: 1, service: "caitlyn-media", status: stopping ? "stopping" : busy ? "busy" : "idle",
				provider, hostedMetadataEnabled: false, metadataApi: true });
			return;
		}
		if (stopping || busy) {
			reply(503, { outcome: "worker_unavailable" });
			return;
		}
		if (request.method !== "POST" || !["/v1/x", "/v1/x/metadata"].includes(request.url ?? "") || request.headers["content-type"] !== "application/json") {
			reply(400, { outcome: "invalid_response" });
			return;
		}
		busy = true;
		const controller = new AbortController();
		active = controller;
		const deadline = setTimeout(() => { controller.abort(); }, operation === "metadata" ? 55_000 : 115_000);
		response.once("close", () => { if (!response.writableFinished) controller.abort(); });
		activeWork = (async () => {
			let body = "";
			for await (const chunk of request) {
				body += chunk.toString();
				if (Buffer.byteLength(body) > 2_048) {
					reply(413, { outcome: "invalid_response" });
					return;
				}
			}
			const parsed = JSON.parse(body);
			const metadata = operation === "metadata" ? validateSocialMetadataRequest(parsed) : undefined;
			const input = validateSocialWorkerRequest(metadata ? { ...metadata, attachmentBytes: SOCIAL_FILE_LIMIT, totalBytes: SOCIAL_TOTAL_LIMIT } : parsed);
			logger.debug("Social worker accepted a bounded X job", `operation=${operation}`);
			const result = await run(input, controller.signal, operation);
			if (!response.destroyed) {
				reply(200, metadata ? { ...decodeSocialMetadataResult(result, metadata), version: 1, purpose: "metadata", provider: "fxembed" } : result);
			}
		})().catch(() => {
			if (!response.destroyed && !response.writableEnded) reply(502, { outcome: "worker_unavailable" });
			logger.warn("Social worker request failed; no raw content logged");
		}).finally(() => {
			clearTimeout(deadline);
			busy = false;
		});
	});
	server.requestTimeout = 5_000;
	server.headersTimeout = 5_000;
	server.maxConnections = 8;
	server.on("clientError", (_error, socket) => { socket.destroy(); });
	// Refuse existing sockets instead of unlinking a path another process might own.
	try {
		await lstat(socketPath);
		throw new Error("worker_socket_already_exists");
	}
	catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	await chmod(socketPath, 0o600);
	const identity = await lstat(socketPath);
	return {
		async stop(): Promise<void> {
			stopping = true;
			active?.abort();
			server.closeAllConnections();
			await new Promise<void>((resolve) => {
				server.close(() => { resolve(); });
			});
			await activeWork;
			const current = await lstat(socketPath).catch(() => undefined);
			if (current?.isSocket() && current.ino === identity.ino) await unlink(socketPath);
		},
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const provider = parseXMetadataProvider(process.env.SOCIAL_X_PROVIDER);
		const run = await createDockerSocialRunner(process.env.SOCIAL_WORKER_DOCKER_CONTEXT ?? "default", process.env.SOCIAL_WORKER_IMAGE ?? "caitlyn-media-api:local", provider, process.env.SOCIAL_FXEMBED_URL, process.env.SOCIAL_FXEMBED_KEY_FILE);
		const service = await startSocialWorkerServer(process.env.SOCIAL_WORKER_SOCKET ?? "", run, { provider });
		logger.info("Local social worker ready; socket access is owner-only", `mode=${provider}`, "extractor=fxembed", `localApiAuth=${Boolean(process.env.SOCIAL_FXEMBED_KEY_FILE)}`);
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			process.once(signal, () => {
				void service.stop().catch(() => {
					logger.error("Social worker shutdown needs attention");
					process.exitCode = 1;
				});
			});
		}
	}
	catch {
		logger.error("Social worker startup failed; check provider, socket ownership, local Docker context, and installed image");
		process.exitCode = 1;
	}
}
