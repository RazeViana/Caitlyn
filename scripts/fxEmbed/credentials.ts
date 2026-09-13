/**
 * @file credentials.ts
 * @description Loads one explicitly selected 1Password X session and encrypts it in memory for FxEmbed.
 * Never prints item values, persists account cookies, or includes secrets in process arguments.
 *
 * @module fxEmbedCredentials
 */

import { execFile } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";

export interface XSession { username: string; authToken: string; csrfToken: string }

export function parseXSession(item: unknown): XSession {
	const fields = (item as { fields?: { label?: unknown; value?: unknown }[] } | null)?.fields;
	if (!Array.isArray(fields)) throw new Error("invalid_x_session_item");
	const field = (label: string): string => {
		const matches = fields.filter((entry) => entry?.label === label);
		if (matches.length !== 1 || typeof matches[0].value !== "string") throw new Error("missing_or_duplicate_x_session_field");
		return matches[0].value;
	};
	const session = { username: field("username"), authToken: field("auth_token"), csrfToken: field("ct0") };
	if (!/^[a-zA-Z0-9_]{1,15}$/.test(session.username) || !/^[a-fA-F0-9]{40}$/.test(session.authToken)
		|| !/^[a-fA-F0-9]{32,256}$/.test(session.csrfToken)) throw new Error("invalid_x_session_fields");
	return session;
}

export async function loadXSession(vault: string, item: string): Promise<XSession> {
	for (const value of [vault, item]) {
		if (!value || value.length > 200 || value.startsWith("-") || /[\p{Cc}]/u.test(value)) throw new Error("invalid_onepassword_reference");
	}
	return new Promise((resolve, reject) => {
		execFile("op", ["item", "get", item, "--vault", vault, "--format", "json"], { timeout: 45_000, maxBuffer: 65_536 }, (error, stdout) => {
			if (error) {
				reject(new Error("onepassword_session_read_failed_unlock_and_check_cli_access"));
				return;
			}
			try { resolve(parseXSession(JSON.parse(stdout))); }
			catch { reject(new Error("x_session_requires_username_auth_token_ct0")); }
		});
	});
}

export function encryptXSession(session: XSession, apiKey: string) {
	// Validate again so callers cannot inject Cookie/header delimiters into the upstream session.
	parseXSession({ fields: [{ label: "username", value: session.username }, { label: "auth_token", value: session.authToken }, { label: "ct0", value: session.csrfToken }] });
	if (!/^[a-f0-9]{64}$/.test(apiKey)) throw new Error("invalid_fxembed_api_key");
	const key = randomBytes(32);
	const iv = randomBytes(12);
	const plaintext = Buffer.from(JSON.stringify({ twitter: { accounts: [session] } }));
	try {
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
		return { ENCRYPTED_CREDENTIALS: encrypted.toString("base64"), CREDENTIALS_IV: iv.toString("base64"),
			CREDENTIAL_KEY: key.toString("base64url"), CAITLYN_API_KEY: apiKey };
	}
	finally {
		plaintext.fill(0);
		key.fill(0);
	}
}
