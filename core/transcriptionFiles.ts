/**
 * @file transcriptionFiles.ts
 * @description Writes private transcript settings and recovery evidence durably without exposing conversation data.
 * @module transcriptionFiles
 */

import { randomUUID, createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function syncDirectory(directory: string): Promise<void> {
	const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
	try { await handle.sync(); }
	finally { await handle.close(); }
}

export async function privateJson(path: string, value: unknown): Promise<void> {
	const temporary = path + "." + randomUUID() + ".tmp";
	const handle = await open(temporary, "wx", 0o600);
	try {
		await handle.writeFile(JSON.stringify(value) + "\n");
		await handle.sync();
	}
	finally { await handle.close(); }
	await rename(temporary, path);
	await syncDirectory(dirname(path));
}

/** A checkpoint may pass invalid bytes only after this evidence is safely on disk. */
export async function quarantineTranscript(directory: string, source: string, offset: number, raw: Buffer): Promise<void> {
	const destination = join(directory, "quarantine", dirname(source));
	await mkdir(destination, { recursive: true, mode: 0o700 });
	const key = createHash("sha256").update(source + ":" + offset + ":").update(raw).digest("hex");
	await privateJson(join(destination, key + ".json"), { source, offset, bytes: raw.length, encoding: "base64", data: raw.toString("base64") });
}
