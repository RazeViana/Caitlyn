/**
 * @file testSocialMetadataLocal.ts
 * @description Checks the private self-hosted metadata API using a canonical public X link and no media download.
 * Emits content-free counts only; never starts a bot, contacts Discord, or prints provider URLs/content.
 *
 * @module testSocialMetadataLocal
 */

import { pathToFileURL } from "node:url";
import { requestSocialMetadata } from "../core/socialWorkerClient.js";
import logger from "../core/logger.js";

export async function testSocialMetadataLocal(socket: string, url: string): Promise<void> {
	const result = await requestSocialMetadata(socket, { version: 1, url });
	if (!("post" in result)) {
		logger.warn("Private metadata check failed", result.outcome);
		throw new Error("metadata_check_failed");
	}
	logger.info("Private metadata check", JSON.stringify({ provider: result.provider, outcome: result.outcome,
		characters: result.post.text.length, media: result.post.media.map((item) => item.kind),
		quote: result.post.quote?.state ?? "none", issues: result.post.issues, downloadedMedia: false }));
	if (result.outcome !== "ready") throw new Error("metadata_check_incomplete");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		if (process.argv.length !== 4) throw new Error("invalid_metadata_check_options");
		await testSocialMetadataLocal(process.argv[2], process.argv[3]);
	}
	catch {
		logger.error("Private metadata check failed; use a private socket and canonical public X post URL");
		process.exitCode = 1;
	}
}
