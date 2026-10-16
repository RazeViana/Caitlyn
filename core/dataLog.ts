/**
 * @file dataLog.ts
 * @description Formats selected activity details without message text, credentials or whole objects.
 * Keeps values short and on one line, and preserves the server context of shared logs.
 *
 * @module dataLog
 */

import logger from "./logger.js";
import { currentLogGuild, withLogGuild } from "./logContext.js";
import { truncate } from "./textLimits.js";

const labels = {
	server: "server", channel: "channel", previousChannel: "previous channel", channelName: "channel name",
	user: "user", username: "username", actor: "requested by", message: "message", replyTo: "reply to",
	job: "preview task", post: "post", platform: "platform", command: "command", action: "action",
	fields: "data fields", count: "count", seconds: "seconds counted", characters: "text length",
	attachments: "attachments", role: "message role", record: "saved record", days: "days kept",
	enabled: "turned on", levels: "log types", reason: "reason", status: "status",
	cards: "cards", images: "images", videos: "videos", files: "files", bytes: "media bytes", quote: "has quote",
} as const;

export type DataLogDetails = Partial<Record<keyof typeof labels, string | number | boolean | null>>;

/** Service errors may echo prompts, request bodies or database values; only known codes are safe here. */
export function dataErrorReason(error: unknown): string {
	if (!error || typeof error !== "object") return "error details hidden to keep message text private";
	const failure = error as { code?: unknown; name?: unknown; message?: unknown; status?: unknown };
	if (typeof failure.code === "string" && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND"].includes(failure.code)) {
		return `network connection failed (${failure.code})`;
	}
	const databaseCodes: Record<string, string> = {
		"08000": "database connection failed", "08001": "database connection could not be established",
		"08003": "database connection is closed", "08006": "database connection failed",
		"40001": "database transaction conflicted", "40P01": "database transaction deadlocked",
		"42P01": "required database table is missing", "42703": "required database column is missing",
		"42501": "database permission denied", "53300": "database connection limit reached",
		"55P03": "database lock was unavailable", "57014": "database query was cancelled or exceeded its deadline",
		"57P01": "database is shutting down", "57P02": "database stopped unexpectedly", "57P03": "database is not ready",
	};
	if (typeof failure.code === "string" && Object.hasOwn(databaseCodes, failure.code)) return `${databaseCodes[failure.code]} (${failure.code})`;
	if (typeof failure.message === "string" && ["timeout exceeded when trying to connect", "Connection terminated due to connection timeout"].includes(failure.message)) return "timed out waiting for a database connection";
	if (failure.message === "Query read timeout") return "timed out waiting for a database query response";
	if (failure.name === "TimeoutError") return "the service took too long to answer";
	if (failure.name === "AbortError") return "the request was stopped";
	// These complete messages are created locally; never copy a provider's free-form error text.
	const status = typeof failure.message === "string" ? /^(?:Embedding|Open WebUI) API returned ([45]\d{2})$/.exec(failure.message)?.[1] : undefined;
	return status ? `service returned HTTP ${status}` : "error details hidden to keep message text private";
}

/** Unknown keys and objects are ignored even when a caller bypasses TypeScript. */
export function formatDataDetails(details: DataLogDetails): string {
	const values = { ...details, server: details.server ?? currentLogGuild() };
	return (Object.keys(labels) as (keyof typeof labels)[]).flatMap((key) => {
		const value = values[key];
		if (typeof value === "string") return [`${labels[key]}: ${JSON.stringify(truncate(value, 160)).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")}`];
		if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return [`${labels[key]}: ${value}`];
		return [];
	}).join(" | ");
}

/** Use only fixed explanatory text and explicitly selected metadata, never a raw event or database row. */
export function logData(message: string, details: DataLogDetails, write: (...args: unknown[]) => void = logger.debug): void {
	const server = typeof details.server === "string" ? details.server : currentLogGuild();
	withLogGuild(server, () => write(message, formatDataDetails(details)));
}
