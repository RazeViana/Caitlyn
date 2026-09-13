/**
 * @file testSocialDeliveryLocal.ts
 * @description Verifies real X attachments through the local broker and renderer without a Discord login.
 * Reuses the dedicated test image, logs only metadata counts, and removes its own temporary socket.
 *
 * @module testSocialDeliveryLocal
 */

import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createDockerSocialRunner } from "./socialWorker/runner.js";
import { startSocialWorkerServer } from "./socialWorker/server.js";
import { requestSocialWorker, SOCIAL_FILE_LIMIT, SOCIAL_TOTAL_LIMIT } from "../core/socialWorkerClient.js";
import { renderXPost } from "../core/socialPostRender.js";
import logger from "../core/logger.js";

export async function testSocialDeliveryLocal(selected = "all"): Promise<void> {
	if (!["all", "image", "gallery", "video", "video-regression", "quote"].includes(selected)) throw new Error("invalid_local_delivery_case");
	const run = await createDockerSocialRunner(process.env.SOCIAL_WORKER_DOCKER_CONTEXT ?? "colima-caitlyn-media-test", process.env.SOCIAL_WORKER_IMAGE ?? "caitlyn-media-api:local", "fxembed", process.env.SOCIAL_FXEMBED_URL, process.env.SOCIAL_FXEMBED_KEY_FILE);
	const directory = await mkdtemp("/tmp/caitlyn-delivery-");
	const socket = `${directory}/worker.sock`;
	let service: Awaited<ReturnType<typeof startSocialWorkerServer>> | undefined;
	try {
		service = await startSocialWorkerServer(socket, run);
		for (const [label, url] of [
			["image", "https://x.com/TheHiddenOneAC/status/2097940988492664992"],
			["gallery", "https://x.com/HeyShuggie/status/2097725753634755034"],
			["video", "https://x.com/iClipCx/status/2097745425323209202"],
			["video-regression", "https://x.com/MidPeng/status/2098474088717021414"],
			["quote", "https://x.com/The_Kurieta/status/2097925042214457837"],
		]) {
			if (selected !== "all" && selected !== label) continue;
			const result = await requestSocialWorker(socket, { version: 1, url, attachmentBytes: SOCIAL_FILE_LIMIT, totalBytes: SOCIAL_TOTAL_LIMIT });
			if (!("post" in result)) {
				logger.warn("Local worker returned a bounded failure outcome", label, result.outcome);
				throw new Error(`local_worker_${result.outcome}`);
			}
			const rendered = renderXPost(result.post, result.files, { attachmentBytes: SOCIAL_FILE_LIMIT, messageBytes: SOCIAL_TOTAL_LIMIT });
			logger.info("Local social delivery result", label, JSON.stringify({ outcome: result.outcome, mediaFailures: result.mediaFailures, files: result.files.length,
				bytes: result.files.reduce((total, file) => total + file.data.length, 0), embeds: rendered.payload.embeds?.length,
				quote: result.post.quote?.state ?? "none", omittedMedia: rendered.omittedMedia }));
			if (result.outcome !== "ready" || rendered.omittedMedia || !result.files.length) throw new Error("local_worker_incomplete_result");
			logger.success("Local social delivery verified", label);
		}
	}
	finally {
		await service?.stop();
		await rm(directory, { recursive: true, force: true });
		logger.info("Local delivery test socket and temporary media removed; no Discord messages sent");
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try { await testSocialDeliveryLocal(process.argv[2]); }
	catch {
		logger.error("Local social delivery verification failed; inspect bounded worker outcomes");
		process.exitCode = 1;
	}
}
