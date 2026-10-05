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
import { quarantineTranscript } from "./transcriptionFiles.js";
import { logData } from "./dataLog.js";
import type { TranscriptRecord } from "./transcriptionStore.js";
import { expireTranscripts } from "./transcriptionRetention.js";

const idPattern = /^[1-9]\d{0,19}$/;
const eventTypes = new Set(["session_started", "session_stopped", "present", "joined", "left", "transcript", "message_posted", "message_edited", "message_deleted", "transcript_corrected", "voice_activity", "gap"]);
const batchBytes = 256 * 1024;

function requiredText(value: unknown, maximum = 64_000): string {
	if (typeof value !== "string" || value.length > maximum) throw new Error("Invalid archive text");
	// PostgreSQL cannot represent NUL or unpaired surrogates. Originals remain in JSONL.
	return value.toWellFormed().replaceAll("\0", "\uFFFD");
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
	const recognition = record.recognition as TranscriptRecord["recognition"];
	if (recognition !== undefined && (!recognition || typeof recognition !== "object" || !Array.isArray(recognition.segments) || recognition.segments.length > 128)) throw new Error("Invalid recognition metadata");
	const finite = (metric: unknown): number => {
		if (typeof metric !== "number" || !Number.isFinite(metric)) throw new Error("Invalid recognition metric");
		return metric;
	};
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
			targetEventId: optionalText(record.targetEventId, 128),
			actorId: record.actorId === undefined ? null : discordId(record.actorId),
			actorUsername: optionalText(record.actorUsername, 200),
			recognition: recognition === undefined ? null : {
				model: requiredText(recognition.model, 100), language: requiredText(recognition.language, 20),
				durationSeconds: finite(recognition.durationSeconds), processingSeconds: finite(recognition.processingSeconds),
				segments: recognition.segments.map((segment) => ({ start: finite(segment.start), end: finite(segment.end),
					averageLogProbability: finite(segment.averageLogProbability), noSpeechProbability: finite(segment.noSpeechProbability) })),
			},
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
) WHERE NOT EXISTS (SELECT 1 FROM discord.transcript_retention t WHERE t.guild_id = r.guild_id AND r.occurred_at < t.deleted_before)
ON CONFLICT (event_id) DO NOTHING`;

export class TranscriptionArchive {
	private timer?: NodeJS.Timeout;
	private running?: Promise<void>;
	private maintenance?: Promise<number>;
	private lastProbe = 0;
	private stopped = false;
	private state: "waiting" | "catching up" | "synced" | "retrying" = "waiting";
	private imported = 0;
	private quarantined = 0;
	private lastSuccess = 0;
	private pendingSince = 0;
	private cursor = "";
	private readonly unchanged = new Map<string, string>();
	constructor(
		private readonly database: Pool,
		private readonly directory: string,
		private readonly guildId: string,
		private readonly log: { warn: (message: string) => void; info?: (message: string) => void },
	) { discordId(guildId); }

	status(): string { return this.state + "; " + this.imported + " events imported since startup; " + this.quarantined + " damaged entries quarantined"; }
	health() {
		return { state: this.state, imported: this.imported, quarantined: this.quarantined, lastSuccess: this.lastSuccess,
			stalled: this.state === "retrying" || Boolean(this.pendingSince && Date.now() - this.pendingSince > 300_000) };
	}

	private reportFailure(): void {
		if (this.state !== "retrying") logData("Transcript database archive will retry; private local logs are preserved. Check migration 018 and storage.", { server: this.guildId }, (...args) => this.log.warn(args.join(" ")));
		this.state = "retrying";
	}

	start(): void {
		if (this.timer || this.stopped) return;
		void this.sync();
		this.timer = setInterval(() => { void this.sync(); }, 5_000);
		this.timer.unref();
	}

	/** Single-flight ingestion also makes explicit replays safe alongside the timer. */
	sync(): Promise<void> {
		if (this.maintenance) return this.maintenance.then(() => undefined, () => undefined);
		if (this.running) return this.running;
		this.running = this.scan().catch(() => this.reportFailure()).finally(() => { this.running = undefined; });
		return this.running;
	}

	private async scan(): Promise<void> {
		if (Date.now() - this.lastProbe > 30_000) {
			await this.database.query("SELECT 1 FROM discord.transcript_retention LIMIT 1");
			this.lastProbe = Date.now();
		}
		const root = join(this.directory, this.guildId);
		const channels = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		let pending = false;
		let failures = false;
		const sources: { source: string; channel: string }[] = [];
		// Bound each pass; the persisted offsets continue catch-up on subsequent passes.
		let budget = 16 * batchBytes;
		for (const channel of channels.sort((a, b) => a.name.localeCompare(b.name))) {
			if (!channel.isDirectory() || !idPattern.test(channel.name)) continue;
			const files = await readdir(join(root, channel.name), { withFileTypes: true });
			for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
				if (!file.isFile() || !/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file.name)) continue;
				const source = [this.guildId, channel.name, file.name].join("/");
				sources.push({ source, channel: channel.name });
			}
		}
		// Rotate the start so a busy channel cannot starve another channel's archive.
		sources.sort((a, b) => Number(a.source <= this.cursor) - Number(b.source <= this.cursor) || a.source.localeCompare(b.source));
		for (const { source, channel } of sources) {
			if (this.stopped) return;
			if (budget <= 0) {
				pending = true;
				break;
			}
			this.cursor = source;
			try {
				const result = await this.ingestFile(source, channel);
				budget -= result.bytes;
				pending ||= result.pending;
			}
			catch { failures = true; }
		}
		if (failures) {this.reportFailure();}
		else {
			if (this.state === "retrying" && this.log.info) logData("Transcript database archive recovered.", { server: this.guildId }, (...args) => this.log.info!(args.join(" ")));
			this.lastSuccess = Date.now();
			this.state = pending ? "catching up" : "synced";
		}
		this.pendingSince = pending ? this.pendingSince || Date.now() : 0;
	}

	private async ingestFile(source: string, channelId: string): Promise<{ bytes: number; pending: boolean }> {
		const file = await open(join(this.directory, source), constants.O_RDONLY | constants.O_NOFOLLOW);
		let connection: PoolClient | undefined;
		let broken = false;
		try {
			const stats = await file.stat();
			if (!stats.isFile()) throw new Error("Invalid archive file");
			const fingerprint = `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
			if (this.unchanged.get(source) === fingerprint) return { bytes: 0, pending: false };
			connection = await this.database.connect();
			await connection.query("BEGIN");
			await connection.query("SELECT pg_advisory_xact_lock_shared(hashtext('caitlyn-retention'), hashtext($1))", [this.guildId]);
			const lock = await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext('caitlyn-transcripts'), hashtext($1)) AS locked", [source]);
			if (!lock.rows[0].locked) {
				await connection.query("ROLLBACK");
				return { bytes: 0, pending: true };
			}
			const checkpoint = await connection.query<{ byte_offset: string; discarding_line: boolean }>("SELECT byte_offset, discarding_line FROM discord.transcript_import_offsets WHERE source = $1", [source]);
			const offset = Number(checkpoint.rows[0]?.byte_offset ?? 0);
			let discarding = checkpoint.rows[0]?.discarding_line ?? false;
			if (!Number.isSafeInteger(offset) || stats.size < offset) throw new Error("Archive file was truncated");
			const buffer = Buffer.alloc(Math.min(batchBytes, stats.size - offset));
			const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
			const completeBytes = buffer.subarray(0, bytesRead).lastIndexOf(10) + 1 || (bytesRead === batchBytes ? bytesRead : 0);
			if (!completeBytes) {
				await connection.query("COMMIT");
				if (!bytesRead) this.remember(source, fingerprint);
				return { bytes: 0, pending: bytesRead > 0 };
			}
			const rows = [];
			let quarantined = 0;
			let lineStart = 0;
			while (lineStart < completeBytes) {
				const newline = buffer.indexOf(10, lineStart);
				const next = newline < 0 ? completeBytes : newline + 1;
				const raw = buffer.subarray(lineStart, newline < 0 ? next : newline);
				try {
					if (discarding || newline < 0) throw new Error("Oversized record fragment");
					if (raw.toString("utf8").trim()) rows.push(archivedEvent(JSON.parse(raw.toString("utf8")), source, offset + lineStart, this.guildId, channelId));
				}
				catch {
					await quarantineTranscript(this.directory, source, offset + lineStart, buffer.subarray(lineStart, next));
					quarantined++;
				}
				discarding = newline < 0;
				lineStart = next;
			}
			const result = await connection.query(insertEvents, [JSON.stringify(rows)]);
			await connection.query(`INSERT INTO discord.transcript_import_offsets (source, byte_offset, discarding_line) VALUES ($1, $2, $3)
				ON CONFLICT (source) DO UPDATE SET byte_offset = EXCLUDED.byte_offset, discarding_line = EXCLUDED.discarding_line, updated_at = NOW()`, [source, offset + completeBytes, discarding]);
			await connection.query("COMMIT");
			this.imported += result.rowCount ?? 0;
			this.quarantined += quarantined;
			if (quarantined) logData("Damaged transcript entries preserved in private quarantine; database import continued.", { server: this.guildId, channel: channelId, count: quarantined }, (...args) => this.log.warn(args.join(" ")));
			if (stats.size === offset + completeBytes) this.remember(source, fingerprint);
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

	private remember(source: string, fingerprint: string): void {
		if (this.unchanged.size >= 10000) this.unchanged.delete(this.unchanged.keys().next().value!);
		this.unchanged.set(source, fingerprint);
	}

	async correction(eventId: string, actorId: string, actorUsername: string, text: string): Promise<TranscriptRecord> {
		if (!/^[a-zA-Z0-9_-]{1,128}$/.test(eventId) || !text.trim() || text.length > 2000) throw new Error("Invalid correction");
		const result = await this.database.query(`SELECT * FROM discord.transcript_events WHERE event_id = $1 AND guild_id = $2
			AND event_type = 'transcript' AND audience_version = 1 AND audience_user_ids @> ARRAY[$3]::text[]`, [eventId, this.guildId, discordId(actorId)]);
		const original = result.rows[0];
		if (!original) throw new Error("Transcript unavailable to this participant");
		return { type: "transcript_corrected", at: new Date().toISOString(), guildId: this.guildId,
			channelId: original.channel_id, channelName: original.channel_name, sessionId: original.session_id,
			userId: original.user_id, speaker: original.username, text: text.trim(), targetEventId: eventId,
			actorId, actorUsername, audienceVersion: 1, audienceUserIds: original.audience_user_ids };
	}

	expire(days: number, timezone: string): Promise<number> {
		if (this.maintenance) return this.maintenance;
		this.maintenance = (async () => {
			await this.running;
			const count = await expireTranscripts(this.database, this.directory, this.guildId, timezone, days);
			this.unchanged.clear();
			return count;
		})().finally(() => { this.maintenance = undefined; });
		return this.maintenance;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		await this.running;
		await this.maintenance;
		// Remaining durable file records are replayed at the next startup.
	}
}
