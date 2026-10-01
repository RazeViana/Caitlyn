/**
 * @file transcriptionStore.ts
 * @description Appends durable daily transcript records and readable logs with private file permissions.
 * @module transcriptionStore
 */

import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TranscriptRecord {
	type: "session_started" | "session_stopped" | "joined" | "left" | "transcript" | "gap";
	at: string;
	end?: string;
	guildId: string;
	channelId: string;
	channelName: string;
	sessionId: string;
	userId?: string;
	speaker?: string;
	text?: string;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

export function transcriptDay(at: string | number, timezone: string): string {
	if (!dayFormatters.has(timezone)) dayFormatters.set(timezone, new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }));
	const parts = dayFormatters.get(timezone)!.formatToParts(new Date(at));
	const part = (name: string) => parts.find((item) => item.type === name)!.value;
	return `${part("year")}-${part("month")}-${part("day")}`;
}

function singleLine(value: string): string { return value.replace(/[\r\n\p{Cc}]/gu, " "); }

export class TranscriptionStore {
	private tail: Promise<void> = Promise.resolve();
	constructor(readonly directory: string, readonly timezone: string) {}

	async initialize(): Promise<void> { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }

	async paused(): Promise<boolean> {
		try {
			const settings = JSON.parse(await readFile(join(this.directory, "settings.json"), "utf8"));
			if (typeof settings.paused !== "boolean") throw new Error("Invalid transcription settings");
			return settings.paused;
		}
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}

	async setPaused(paused: boolean): Promise<void> {
		const temporary = join(this.directory, "settings.json.tmp");
		await writeFile(temporary, `${JSON.stringify({ paused })}\n`, { mode: 0o600 });
		await rename(temporary, join(this.directory, "settings.json"));
	}

	append(record: TranscriptRecord): Promise<void> {
		const operation = this.tail.then(async () => {
			if (!/^[1-9]\d*$/.test(record.guildId) || !/^[1-9]\d*$/.test(record.channelId)) throw new Error("Invalid transcript identity");
			const directory = join(this.directory, record.guildId, record.channelId);
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const base = join(directory, transcriptDay(record.at, this.timezone));
			const timestamp = new Intl.DateTimeFormat("en-GB", { timeZone: this.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "shortOffset", hour12: false }).format(new Date(record.at));
			const who = record.userId ? `${singleLine(record.speaker ?? "Unknown")} (${record.userId})` : "Caitlyn";
			const content = record.type === "transcript" ? record.text ?? "" : `[${record.type}] ${record.text ?? ""}`;
			// JSONL is authoritative. Text is a convenient append-only view; capture timestamps define ordering.
			for (const [extension, data] of [["jsonl", `${JSON.stringify({ version: 1, timezone: this.timezone, ...record })}\n`], ["txt", `[${timestamp}] ${who}: ${singleLine(content)}\n`]]) {
				const file = await open(`${base}.${extension}`, "a", 0o600);
				try {
					await file.writeFile(data);
					await file.sync();
				}
				finally { await file.close(); }
			}
		});
		this.tail = operation.catch(() => undefined);
		return operation;
	}

	async drain(): Promise<void> { await this.tail; }
}
