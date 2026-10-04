/**
 * @file healthcheck.mjs
 * @description Checks the recorder's private dependency heartbeat without contacting Discord or exposing transcript data.
 * @module transcriptionHealthcheck
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
try {
	const directory = process.env.TRANSCRIPTION_DIRECTORY;
	if (!directory || process.env.TRANSCRIPTION_ENABLED !== "true") process.exit(0);
	const health = JSON.parse(await readFile(join(directory, "health.json"), "utf8"));
	process.exit(health.healthy === true && Date.now() - health.checkedAt < 120_000 && health.checkedAt <= Date.now() + 5000 ? 0 : 1);
}
catch { process.exit(1); }
