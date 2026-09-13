/**
 * @file envSession.ts
 * @description Reads only the local FxEmbed account fields from an owner-only environment file.
 * Does not populate process.env, invoke 1Password, or pass unrelated bot settings to the backend.
 *
 * @module fxEmbedEnvSession
 */

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parse } from "dotenv";
import { parseXSession, type XSession } from "./credentials.js";

const names = ["FXEMBED_X_USERNAME", "FXEMBED_X_AUTH_TOKEN", "FXEMBED_X_CT0"] as const;
const fileLimit = 65_536;

export function parseXSessionEnv(source: string): XSession {
	if (Buffer.byteLength(source) > fileLimit) throw new Error("fxembed_env_file_too_large");
	const assignments = [...source.matchAll(/^\s*(?:export\s+)?(FXEMBED_X_\w+)\s*=/gm)].map((match) => match[1]);
	if (names.some((name) => assignments.filter((entry) => entry === name).length > 1)) throw new Error("duplicate_fxembed_env_fields");
	const values = parse(source);
	const missing = names.filter((name) => !values[name]);
	if (missing.length) throw new Error("Missing FxEmbed .env fields: " + missing.join(", "));
	try {
		return parseXSession({ fields: [{ label: "username", value: values.FXEMBED_X_USERNAME },
			{ label: "auth_token", value: values.FXEMBED_X_AUTH_TOKEN }, { label: "ct0", value: values.FXEMBED_X_CT0 }] });
	}
	catch { throw new Error("Invalid FxEmbed .env fields: use a handle without @ and the complete auth_token and ct0 cookie values"); }
}

export async function loadXSessionFromEnv(file: string): Promise<XSession> {
	const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
		.catch(() => { throw new Error("fxembed_env_file_unreadable"); });
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.nlink !== 1) throw new Error("fxembed_env_file_must_be_owner_only_0600");
		if (info.size > fileLimit) throw new Error("fxembed_env_file_too_large");
		const bytes = Buffer.alloc(fileLimit + 1);
		try {
			const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
			return parseXSessionEnv(bytes.subarray(0, bytesRead).toString("utf8"));
		}
		finally { bytes.fill(0); }
	}
	finally { await handle.close(); }
}
