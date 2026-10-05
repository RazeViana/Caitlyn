/**
 * @file transcriptionStore.ts
 * @description Appends private daily records, preserving event IDs and capture-time audiences for database replay alongside readable logs.
 * @module transcriptionStore
 */

import { mkdir, open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { privateJson, syncDirectory } from "./transcriptionFiles.js";
import type { CapturedAttachment } from "./transcriptionAssets.js";

export interface TranscriptSettings { paused: boolean; excludedChannelIds?: string[]; retentionDays?: number }

export interface RecognitionDetails {
	model: string;
	language: string;
	durationSeconds: number;
	processingSeconds: number;
	segments: { start: number; end: number; averageLogProbability: number; noSpeechProbability: number }[];
}

export interface TranscriptRecord {
	eventId?: string;
	audienceVersion?: 1;
	audienceUserIds?: string[];
	type: "session_started" | "session_stopped" | "present" | "joined" | "left" | "transcript" | "message_posted" | "message_edited" | "message_deleted" | "transcript_corrected" | "voice_activity" | "gap";
	at: string;
	end?: string;
	guildId: string;
	channelId: string;
	channelName: string;
	sessionId: string;
	userId?: string;
	speaker?: string;
	text?: string;
	activityChannelId?: string;
	activityChannelName?: string;
	activityParentChannelId?: string;
	activityParentChannelName?: string;
	messageId?: string;
	messageUrl?: string;
	attachmentNames?: string[];
	attachments?: CapturedAttachment[];
	avatarHash?: string | null;
	targetEventId?: string;
	actorId?: string;
	actorUsername?: string;
	recognition?: RecognitionDetails;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

export function transcriptDay(at: string | number, timezone: string): string {
	if (!dayFormatters.has(timezone)) dayFormatters.set(timezone, new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }));
	const parts = dayFormatters.get(timezone)!.formatToParts(new Date(at));
	const part = (name: string) => parts.find((item) => item.type === name)!.value;
	return `${part("year")}-${part("month")}-${part("day")}`;
}

function singleLine(value: string): string { return value.replace(/[\r\n\p{Cc}\p{Zl}\p{Zp}]/gu, " "); }

function readableContent(record: TranscriptRecord): string {
	if (record.type === "transcript") return record.text ?? "";
	const voiceChannel = `"${record.channelName}" (${record.channelId})`;
	if (record.type === "joined") return `[joined] Joined voice channel ${voiceChannel}. ${record.text ?? ""}`.trimEnd();
	if (record.type === "left") return `[left] Left voice channel ${voiceChannel}. ${record.text ?? ""}`.trimEnd();
	if (record.type === "present") return `[present] Present in voice channel ${voiceChannel}. ${record.text ?? ""}`.trimEnd();
	if (["message_posted", "message_edited", "message_deleted"].includes(record.type)) {
		const channel = record.activityParentChannelName
			? `#${record.activityParentChannelName} / #${record.activityChannelName}` : `#${record.activityChannelName}`;
		const attachments = record.attachmentNames?.length ? ` | Attachments: ${record.attachmentNames.join(", ")}` : "";
		const action = record.type === "message_posted" ? "Posted" : record.type === "message_edited" ? "Edited" : "Deleted";
		return `[${record.type}] ${action} in ${channel} (${record.activityChannelId}) | ${record.messageUrl} | Message: ${record.text ?? ""}${attachments}`;
	}
	if (record.type === "transcript_corrected") return `[transcript_corrected] Event ${record.targetEventId} | Corrected by ${record.actorUsername} (${record.actorId}) | ${record.text}`;
	return `[${record.type}] ${record.text ?? ""}`;
}

export class TranscriptionStore {
	private tail: Promise<void> = Promise.resolve();
	constructor(readonly directory: string, readonly timezone: string) {}

	async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }

	async settings(): Promise<TranscriptSettings> {
		try {
			const settings = JSON.parse(await readFile(join(this.directory, "settings.json"), "utf8"));
			if (typeof settings.paused !== "boolean") throw new Error("Invalid transcription settings");
			if (settings.excludedChannelIds !== undefined && (!Array.isArray(settings.excludedChannelIds) || settings.excludedChannelIds.some((id: unknown) => typeof id !== "string" || !/^[1-9]\d{0,19}$/.test(id)))) throw new Error("Invalid channel exclusions");
			if (settings.retentionDays !== undefined && (!Number.isInteger(settings.retentionDays) || settings.retentionDays < 0 || settings.retentionDays > 36500)) throw new Error("Invalid retention setting");
			return settings;
		}
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { paused: false };
			throw error;
		}
	}

	async paused(): Promise<boolean> { return (await this.settings()).paused; }
	async setPaused(paused: boolean): Promise<void> { await this.updateSettings({ paused }); }
	async updateSettings(changes: Partial<TranscriptSettings>): Promise<void> { await privateJson(join(this.directory, "settings.json"), { ...await this.settings(), ...changes }); }

	async markSession(record: TranscriptRecord | null): Promise<void> {
		await privateJson(join(this.directory, "active-session.json"), record ? {
			guildId: record.guildId, channelId: record.channelId, channelName: record.channelName, sessionId: record.sessionId,
		} : null);
	}

	async recoverSession(guildId: string): Promise<boolean> {
		let previous;
		try { previous = JSON.parse(await readFile(join(this.directory, "active-session.json"), "utf8")); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
		if (!previous) return false;
		if (previous.guildId !== guildId || typeof previous.channelName !== "string" || typeof previous.sessionId !== "string") throw new Error("Invalid recording recovery marker");
		await this.append({ ...previous, eventId: randomUUID(), type: "gap", at: new Date().toISOString(), audienceVersion: 1, audienceUserIds: [],
			text: "Recorder restarted before closing this session. Unprocessed audio and activity during the interruption are unavailable; membership must be established again." });
		await this.markSession(null);
		return true;
	}

	append(record: TranscriptRecord): Promise<void> {
		const operation = this.tail.then(async () => {
			if (!/^[1-9]\d*$/.test(record.guildId) || !/^[1-9]\d*$/.test(record.channelId)) throw new Error("Invalid transcript identity");
			const directory = join(this.directory, record.guildId, record.channelId);
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const base = join(directory, transcriptDay(record.at, this.timezone));
			const timestamp = new Intl.DateTimeFormat("en-GB", { timeZone: this.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "shortOffset", hour12: false }).format(new Date(record.at));
			const who = record.userId ? `${singleLine(record.speaker ?? "Unknown")} (${record.userId})` : "Caitlyn";
			const content = readableContent(record);
			// JSONL is authoritative. Text is a convenient append-only view; capture timestamps define ordering.
			for (const [extension, data] of [["jsonl", `${JSON.stringify({ version: 1, timezone: this.timezone, ...record })}\n`], ["txt", `[${timestamp}] ${who}: ${singleLine(content)}\n`]]) {
				const file = await open(`${base}.${extension}`, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
				try {
					// Preserve a crash tail as its own line so it cannot swallow the next valid event.
					const { size } = await file.stat();
					if (size) {
						const last = Buffer.alloc(1);
						await file.read(last, 0, 1, size - 1);
						if (last[0] !== 10) await file.writeFile("\n");
					}
					await file.writeFile(data);
					await file.sync();
				}
				finally { await file.close(); }
			}
			await syncDirectory(directory);
		});
		this.tail = operation.catch(() => undefined);
		return operation;
	}

	async drain(): Promise<void> { await this.tail; }
}
