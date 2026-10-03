/**
 * @file transcriptionArchive.ts
 * @description Replays private JSONL logs into PostgreSQL with atomic checkpoints, duplicate protection and immutable event audiences.
 * @module transcriptionArchive
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";

const idPattern = /^[1-9]\d{0,19}$/;
const eventTypes = new Set(["session_started", "session_stopped", "present", "joined", "left", "transcript", "message_posted", "voice_activity", "gap"]);
const batchBytes = 256 * 1024;

function requiredText(value: unknown, maximum = 64_000): string {
	if (typeof value !== "string" || value.length > maximum || value.includes("\0")) throw new Error("Invalid archive text");
	return value;
}

function optionalText(value: unknown, maximum = 64_000): string | null {
	return value === undefined || value === null ? null : requiredText(value, maximum);
}

function discordId(value: unknown): string {
	if (typeof value !== "string" || !idPattern.test(value)) throw new Error("Invalid archive identity");
	return value;
}

function date(value: unknown): string {
	const parsed = Date.parse(requiredText(value, 100));
	if (!Number.isFinite(parsed)) throw new Error("Invalid archive timestamp");
	return new Date(parsed).toISOString();
}

/** Missing or unsupported audience metadata is deliberately private to the operator. */
export function archivedEvent(value: unknown, source: string, offset: number, guildId: string, channelId: string) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid archive record");
	const record = value as Record<string, unknown>;
	if (record.version !== 1 || record.guildId !== guildId || record.channelId !== channelId) throw new Error("Archive source mismatch");
	const type = requiredText(record.type, 32);
	if (!eventTypes.has(type)) throw new Error("Unknown archive event");
	const occurredAt = date(record.at);
	const endedAt = record.end === undefined ? null : date(record.end);
	if (endedAt && endedAt < occurredAt) throw new Error("Invalid archive interval");
	let audience: string[] = [];
	if (record.audienceVersion === 1) {
		if (!Array.isArray(record.audienceUserIds) || record.audienceUserIds.length > 1000) throw new Error("Invalid archive audience");
		audience = [...new Set(record.audienceUserIds.map(discordId))];
	}
	const suppliedId = record.eventId === undefined ? undefined : requiredText(record.eventId, 128);
	if (suppliedId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(suppliedId)) throw new Error("Invalid archive event ID");
	const eventId = suppliedId ?? "legacy_" + createHash("sha256").update(source + ":" + offset).digest("hex");
	const attachments = record.attachmentNames;
	if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > 100)) throw new Error("Invalid attachments");
	return {
		event_id: eventId, guild_id: discordId(guildId), channel_id: discordId(channelId),
		channel_name: requiredText(record.channelName, 200), session_id: requiredText(record.sessionId, 128),
		event_type: type, occurred_at: occurredAt, ended_at: endedAt,
		user_id: record.userId === undefined ? null : discordId(record.userId),
		username: optionalText(record.speaker, 200), content: optionalText(record.text),
		activity_channel_id: record.activityChannelId === undefined ? null : discordId(record.activityChannelId),
		activity_channel_name: optionalText(record.activityChannelName, 200),
		message_id: record.messageId === undefined ? null : discordId(record.messageId),
		message_url: optionalText(record.messageUrl, 500),
		metadata: {
			timezone: requiredText(record.timezone, 100),
			activityParentChannelId: record.activityParentChannelId === undefined ? null : discordId(record.activityParentChannelId),
			activityParentChannelName: optionalText(record.activityParentChannelName, 200),
			attachmentNames: (attachments as unknown[] | undefined)?.map((name) => requiredText(name, 1000)) ?? [],
		},
		audience_version: record.audienceVersion === 1 ? 1 : 0,
		audience_user_ids: audience,
	};
}

const insertEvents = `INSERT INTO discord.transcript_events (
	event_id, guild_id, channel_id, channel_name, session_id, event_type, occurred_at, ended_at,
	user_id, username, content, activity_channel_id, activity_channel_name, message_id, message_url,
	metadata, audience_version, audience_user_ids
) SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(
	event_id text, guild_id text, channel_id text, channel_name text, session_id text, event_type text,
	occurred_at timestamptz, ended_at timestamptz, user_id text, username text, content text,
	activity_channel_id text, activity_channel_name text, message_id text, message_url text,
	metadata jsonb, audience_version smallint, audience_user_ids text[]
) ON CONFLICT (event_id) DO NOTHING`;

export class TranscriptionArchive {
	private timer?: NodeJS.Timeout;
	private running?: Promise<void>;
	private stopped = false;
	private state: "waiting" | "catching up" | "synced" | "retrying" = "waiting";
	private imported = 0;
	constructor(
		private readonly database: Pool,
		private readonly directory: string,
		private readonly guildId: string,
		private readonly log: { warn: (message: string) => void },
	) { discordId(guildId); }

	status(): string { return this.state + "; " + this.imported + " events imported since startup"; }

	start(): void {
		if (this.timer || this.stopped) return;
		void this.sync();
		this.timer = setInterval(() => { void this.sync(); }, 5_000);
		this.timer.unref();
	}

	/** Single-flight ingestion also makes explicit replays safe alongside the timer. */
	sync(): Promise<void> {
		if (this.running) return this.running;
		this.running = this.scan().catch(() => {
			if (this.state !== "retrying") this.log.warn("Transcript database archive will retry; private local logs are preserved. Check database migration 017 and storage.");
			this.state = "retrying";
		}).finally(() => { this.running = undefined; });
		return this.running;
	}

	private async scan(): Promise<void> {
		const root = join(this.directory, this.guildId);
		const channels = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		let pending = false;
		// Bound each pass; the persisted offsets continue catch-up on subsequent passes.
		let budget = 16 * batchBytes;
		for (const channel of channels.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!channel.isDirectory() || !idPattern.test(channel.name)) continue;
			const files = await readdir(join(root, channel.name), { withFileTypes: true });
			for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
				if (!file.isFile() || !/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file.name)) continue;
				if (budget <= 0) {
					pending = true;
					break;
				}
				const source = [this.guildId, channel.name, file.name].join("/");
				const result = await this.ingestFile(source, channel.name);
				budget -= result.bytes;
				pending ||= result.pending;
			}
		}
		this.state = pending ? "catching up" : "synced";
	}

	private async ingestFile(source: string, channelId: string): Promise<{ bytes: number; pending: boolean }> {
		const file = await open(join(this.directory, source), constants.O_RDONLY | constants.O_NOFOLLOW);
		let connection: PoolClient | undefined;
		let broken = false;
		try {
			const stats = await file.stat();
			if (!stats.isFile()) throw new Error("Invalid archive file");
			connection = await this.database.connect();
			await connection.query("BEGIN");
			const lock = await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('caitlyn-transcripts'), hashtext($1)) AS locked", [source]);
			if (!lock.rows[0].locked) {
				await connection.query("ROLLBACK");
				return { bytes: 0, pending: true };
			}
			const checkpoint = await connection.query<{ byte_offset: string }>("SELECT byte_offset FROM discord.transcript_import_offsets WHERE source = $1", [source]);
			const offset = Number(checkpoint.rows[0]?.byte_offset ?? 0);
			if (!Number.isSafeInteger(offset) || stats.size < offset) throw new Error("Archive file was truncated");
			const buffer = Buffer.alloc(Math.min(batchBytes, stats.size - offset));
			const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
			const completeBytes = buffer.subarray(0, bytesRead).lastIndexOf(10) + 1;
			if (!completeBytes && bytesRead === batchBytes) throw new Error("Oversized archive record");
			if (!completeBytes) {
				await connection.query("COMMIT");
				return { bytes: 0, pending: bytesRead > 0 };
			}
			const rows = [];
			let lineStart = 0;
			while (lineStart < completeBytes) {
				const lineEnd = buffer.indexOf(10, lineStart);
				const raw = buffer.subarray(lineStart, lineEnd).toString("utf8");
				if (raw.trim()) rows.push(archivedEvent(JSON.parse(raw), source, offset + lineStart, this.guildId, channelId));
				lineStart = lineEnd + 1;
			}
			const result = await connection.query(insertEvents, [JSON.stringify(rows)]);
			await connection.query(`INSERT INTO discord.transcript_import_offsets (source, byte_offset) VALUES ($1, $2)
				ON CONFLICT (source) DO UPDATE SET byte_offset = EXCLUDED.byte_offset, updated_at = NOW()`, [source, offset + completeBytes]);
			await connection.query("COMMIT");
			this.imported += result.rowCount ?? 0;
			return { bytes: completeBytes, pending: stats.size > offset + completeBytes };
		}
		catch (error) {
			if (connection) {
				try { await connection.query("ROLLBACK"); }
				catch { broken = true; }
			}
			throw error;
		}
		finally {
			connection?.release(broken);
			await file.close();
		}
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		await this.running;
		// Remaining durable file records are replayed at the next startup.
	}
}
