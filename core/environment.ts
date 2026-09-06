/**
 * @file environment.ts
 * @description Loads and validates bot configuration before service initialization.
 * Checks required settings and optional defaults without exposing their values in errors.
 *
 * @module environment
 */

import "dotenv/config";

export type Environment = Record<string, string | undefined>;

const requiredBotVariables = [
	"TOKEN",
	"GUILD_ID",
	"GENERAL_CHAT_ID",
	"GIPHY_API_KEY",
	"PGHOST",
	"PGPORT",
	"PGUSER",
	"PGPASSWORD",
	"PGDATABASE",
	"OLLAMA_MODEL",
	"WEBUI_API_KEY",
	"WEBUI_CHAT_ENDPOINT",
	"EMBEDDING_MODEL",
	"EMBEDDING_ENDPOINT",
] as const;

export function validateEnvironment(environment: Environment = process.env): void {
	const errors: string[] = [];
	const present = (name: string): boolean => Boolean(environment[name]?.trim());

	for (const name of requiredBotVariables) {
		if (!present(name)) errors.push(`${name} is required`);
	}

	for (const name of ["GUILD_ID", "GENERAL_CHAT_ID"]) {
		if (present(name) && !/^[1-9]\d*$/.test(environment[name]!)) {
			errors.push(`${name} must be a numeric Discord ID`);
		}
	}

	for (const name of ["WEBUI_CHAT_ENDPOINT", "EMBEDDING_ENDPOINT"]) {
		if (!present(name)) continue;
		try {
			const url = new URL(environment[name]!);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				throw new Error("Unsupported protocol");
			}
		}
		catch {
			errors.push(`${name} must be an absolute HTTP or HTTPS URL`);
		}
	}

	function validateInteger(name: string, minimum: number, maximum: number): void {
		const value = environment[name];
		if (value === undefined) return;
		if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum) {
			errors.push(`${name} must be an integer from ${minimum} to ${maximum}`);
		}
	}

	validateInteger("PGPORT", 1, 65535);
	validateInteger("CONTEXT_RECENT_COUNT", 0, 2147483647);
	validateInteger("CONTEXT_SIMILAR_COUNT", 0, 2147483647);

	if (environment.LLM_ENABLED !== undefined
		&& environment.LLM_ENABLED !== "true" && environment.LLM_ENABLED !== "false") {
		errors.push("LLM_ENABLED must be true or false");
	}
	if (environment.LOG_LEVEL !== undefined
		&& !["DEBUG", "INFO", "WARN", "ERROR"].includes(environment.LOG_LEVEL.toUpperCase())) {
		errors.push("LOG_LEVEL must be DEBUG, INFO, WARN, or ERROR");
	}

	if (errors.length > 0) {
		throw new Error(`Invalid environment configuration:\n${errors.join("\n")}`);
	}
}
