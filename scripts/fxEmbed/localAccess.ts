/**
 * @file localAccess.ts
 * @description Reads the broker's local API key from an owner-only file, without exposing X credentials.
 * Rejects symlinks, permissive directories/files, and oversized or malformed keys.
 *
 * @module fxEmbedLocalAccess
 */

import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export async function checkPrivateParent(file: string): Promise<void> {
	if (!isAbsolute(file) || /[\p{Cc}]/u.test(file)) throw new Error("invalid_fxembed_key_path");
	const parent = await lstat(dirname(file));
	if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0) throw new Error("fxembed_key_directory_must_be_private");
}

export async function readLocalApiKey(file: string): Promise<string> {
	await checkPrivateParent(file);
	const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.nlink !== 1 || info.size !== 64) throw new Error("invalid_fxembed_key_file");
		const bytes = Buffer.alloc(65);
		const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
		const key = bytes.subarray(0, bytesRead).toString("utf8");
		if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("invalid_fxembed_api_key");
		return key;
	}
	finally { await handle.close(); }
}
