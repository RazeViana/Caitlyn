/**
 * @file environment.ts
 * @description Validates essential Discord configuration and independently gates optional features.
 * Reports missing or invalid variable names without exposing configuration values or secrets.
 *
 * @module environment
 */

import "./loadEnvironment.js";
import { birthdayTimezone } from "./birthdayClock.js";

export type Environment = Record<string, string | undefined>;
export interface FeatureConfiguration {
	configured: boolean;
	enabled: boolean;
	problems: string[];
	switchName?: string;
}

export function getFeatureConfiguration(environment: Environment = process.env) {
	const required = (...names: string[]): string[] => names.filter((name) => !environment[name]?.trim()).map((name) => `${name} is missing`);
	const integer = (name: string, minimum: number, maximum: number): string[] => {
		const value = environment[name];
		return value !== undefined && (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum)
			? [`${name} must be an integer from ${minimum} to ${maximum}`] : [];
	};
	const endpoint = (name: string): string[] => {
		if (!environment[name]?.trim()) return [];
		try {
			const url = new URL(environment[name]!);
			if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("invalid_endpoint");
			return [];
		}
		catch { return [`${name} must be an absolute HTTP or HTTPS URL without credentials`]; }
	};
	const feature = (problems: string[], switchName?: string): FeatureConfiguration => {
		if (switchName && environment[switchName] !== undefined && !["true", "false"].includes(environment[switchName]!)) {
			problems.push(`${switchName} must be true or false`);
		}
		return { configured: !problems.length, enabled: !problems.length && (!switchName || environment[switchName] === "true"), problems, switchName };
	};
	const database = feature([...required("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"), ...integer("PGPORT", 1, 65535)]);
	const databaseDependency = database.configured ? [] : ["database configuration is unavailable"];
	const ai = feature([...required("OLLAMA_MODEL", "WEBUI_API_KEY", "WEBUI_CHAT_ENDPOINT"), ...endpoint("WEBUI_CHAT_ENDPOINT")], "LLM_ENABLED");
	const memory = feature([...required("EMBEDDING_MODEL", "EMBEDDING_ENDPOINT"), ...endpoint("EMBEDDING_ENDPOINT"),
		...integer("CONTEXT_RECENT_COUNT", 0, 2147483647), ...integer("CONTEXT_SIMILAR_COUNT", 0, 2147483647), ...databaseDependency]);
	const birthdays = [...required("GUILD_ID", "GENERAL_CHAT_ID"), ...databaseDependency];
	for (const name of ["GUILD_ID", "GENERAL_CHAT_ID"]) {
		if (environment[name]?.trim() && !/^[1-9]\d*$/.test(environment[name]!)) birthdays.push(`${name} must be a numeric Discord ID`);
	}
	try { birthdayTimezone(environment.BIRTHDAY_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone); }
	catch { birthdays.push("BIRTHDAY_TIMEZONE must be a supported timezone name"); }
	const social = [...required("SOCIAL_WORKER_SOCKET"), ...databaseDependency];
	const socket = environment.SOCIAL_WORKER_SOCKET;
	if (socket?.trim() && (!socket.startsWith("/") || Buffer.byteLength(socket) > 100 || /[\p{Cc}]/u.test(socket))) {
		social.push("SOCIAL_WORKER_SOCKET must be an absolute local socket path of at most 100 UTF-8 bytes");
	}
	return {
		database,
		ai,
		memory,
		birthdayReminders: feature(birthdays),
		giphy: feature(required("GIPHY_API_KEY")),
		socialMedia: feature(social, "SOCIAL_MEDIA_ENABLED"),
		discordLogging: feature([...databaseDependency]),
	};
}

export function validateEnvironment(environment: Environment = process.env): void {
	if (!environment.TOKEN?.trim()) throw new Error("Invalid environment configuration:\nTOKEN is required");
}

export function logFeatureConfiguration(log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void }, environment: Environment = process.env): void {
	for (const [name, state] of Object.entries(getFeatureConfiguration(environment))) {
		if (state.problems.length) log.warn(`Feature ${name} disabled: ${state.problems.join("; ")}`);
		else log.info(`Feature ${name}: ${state.enabled ? "configured" : `disabled (${state.switchName}=false or unset)`}`);
	}
	if (environment.LOG_LEVEL !== undefined && !["DEBUG", "INFO", "WARN", "ERROR"].includes(environment.LOG_LEVEL.toUpperCase())) {
		log.warn("LOG_LEVEL must be DEBUG, INFO, WARN, or ERROR; using INFO");
	}
	log.info("Optional configuration changes require a bot restart; /toggleai can only enable a configured AI service");
}
