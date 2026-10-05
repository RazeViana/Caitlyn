/**
 * @file transcriptionConfig.ts
 * @description Validates local-only voice transcription settings without exposing endpoint values.
 * @module transcriptionConfig
 */

import { isAbsolute } from "node:path";
import { isIP } from "node:net";

export interface TranscriptionConfig {
	databaseEnabled?: boolean;
	backupMonitor?: boolean;
	captureMessages?: boolean;
	guildId: string;
	directory: string;
	endpoint: string;
	channels: string[];
	timezone: string;
	language: string;
}

/** Only explicit local addresses or Docker service names are accepted. No public AI provider. */
export function localTranscriptionEndpoint(value: string): boolean {
	try {
		const url = new URL(value);
		const host = url.hostname;
		const octets = host.split(".").map(Number);
		const localIPv4 = isIP(host) === 4 && (octets[0] === 127 || octets[0] === 10
			|| (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
		const localHost = host === "localhost" || host === "[::1]" || (isIP(host) === 0 && /^[a-z][a-z0-9-]*$/i.test(host));
		return url.protocol === "http:" && !url.username && !url.password && !url.search && !url.hash && (localIPv4 || localHost);
	}
	catch { return false; }
}

export function transcriptionSettings(environment: Record<string, string | undefined> = process.env) {
	const problems: string[] = [];
	const config: TranscriptionConfig = {
		databaseEnabled: environment.TRANSCRIPTION_DATABASE_ENABLED === "true",
		backupMonitor: environment.TRANSCRIPTION_BACKUP_MONITOR === "true",
		captureMessages: environment.TRANSCRIPTION_MESSAGES_ENABLED !== "false",
		guildId: environment.GUILD_ID ?? "",
		directory: environment.TRANSCRIPTION_DIRECTORY ?? "",
		endpoint: environment.TRANSCRIPTION_ENDPOINT ?? "",
		channels: (environment.TRANSCRIPTION_CHANNEL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
		timezone: environment.TRANSCRIPTION_TIMEZONE ?? "Europe/Amsterdam",
		language: environment.TRANSCRIPTION_LANGUAGE ?? "en",
	};
	if (environment.TRANSCRIPTION_ENABLED !== undefined && !["true", "false"].includes(environment.TRANSCRIPTION_ENABLED)) problems.push("TRANSCRIPTION_ENABLED must be true or false");
	if (environment.TRANSCRIPTION_DATABASE_ENABLED !== undefined && !["true", "false"].includes(environment.TRANSCRIPTION_DATABASE_ENABLED)) problems.push("TRANSCRIPTION_DATABASE_ENABLED must be true or false");
	if (environment.TRANSCRIPTION_BACKUP_MONITOR !== undefined && !["true", "false"].includes(environment.TRANSCRIPTION_BACKUP_MONITOR)) problems.push("TRANSCRIPTION_BACKUP_MONITOR must be true or false");
	if (environment.TRANSCRIPTION_MESSAGES_ENABLED !== undefined && !["true", "false"].includes(environment.TRANSCRIPTION_MESSAGES_ENABLED)) problems.push("TRANSCRIPTION_MESSAGES_ENABLED must be true or false");
	if (!/^[1-9]\d*$/.test(config.guildId)) problems.push("GUILD_ID must be a numeric Discord ID");
	if (!isAbsolute(config.directory)) problems.push("TRANSCRIPTION_DIRECTORY must be an absolute persistent directory");
	if (!localTranscriptionEndpoint(config.endpoint)) problems.push("TRANSCRIPTION_ENDPOINT must be a local HTTP service URL without credentials or query parameters");
	if (!config.channels.length || !(config.channels.length === 1 && config.channels[0] === "*") && config.channels.some((id) => !/^[1-9]\d*$/.test(id))) problems.push("TRANSCRIPTION_CHANNEL_IDS must contain voice channel IDs or *");
	try { new Intl.DateTimeFormat("en", { timeZone: config.timezone }).format(); }
	catch { problems.push("TRANSCRIPTION_TIMEZONE must be a supported timezone name"); }
	if (!/^(auto|[a-z]{2,3})$/.test(config.language)) problems.push("TRANSCRIPTION_LANGUAGE must be auto or a language code such as en or nl");
	return { config, problems, configured: !problems.length, enabled: !problems.length && environment.TRANSCRIPTION_ENABLED === "true", switchName: "TRANSCRIPTION_ENABLED" };
}
