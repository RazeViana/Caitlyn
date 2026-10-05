/**
 * @file transcriptionAssets.ts
 * @description Saves Discord uploads privately and exports profile hashes for the authenticated transcript website.
 * @module transcriptionAssets
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import type { Attachment, Client } from "discord.js";
import type { Pool } from "pg";
import { privateJson, syncDirectory } from "./transcriptionFiles.js";
import { TranscriptionProfiles } from "./transcriptionProfiles.js";

const id = /^[1-9]\d{0,19}$/;
const eventId = /^[a-zA-Z0-9_-]{1,128}$/;
const maxBytes = 1024 * 1024 * 1024;
export interface CapturedAttachment { id: string; name: string; size: number; contentType: string; url: string }
interface SavedAttachment extends CapturedAttachment {
	key: string; state: "pending" | "ready" | "unavailable"; attempts: number; retryAt: number; sha256?: string;
}
interface AssetEvent {
	version: 1; eventId: string; guildId: string; channelId: string; messageId: string; at: string;
	attachments: SavedAttachment[];
}
export interface AssetRow {
	event_id: string; guild_id: string; activity_channel_id: string; message_id: string; event_type: string;
	occurred_at: Date; content: string | null; metadata: { attachmentNames?: string[]; attachments?: CapturedAttachment[] };
}
export function assetEventKey(guild: string, event: string): string {
	return createHash("sha256").update(`${guild}:${event}`).digest("hex");
}
export function assetFileKey(guild: string, event: string, attachment: string): string {
	return createHash("sha256").update(`${guild}:${event}:${attachment}`).digest("hex");
}

export function attachmentUrl(value: string, channel: string, attachment: string): boolean {
	try {
		const url = new URL(value);
		return id.test(channel) && id.test(attachment) && url.protocol === "https:"
			&& ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)
			&& !url.username && !url.password && !url.port
			&& url.pathname.startsWith(`/attachments/${channel}/${attachment}/`);
	}
	catch { return false; }
}

export function captureAttachments(items: Iterable<Attachment>, channel: string): CapturedAttachment[] {
	return [...items].slice(0, 100).filter((item) => id.test(item.id) && typeof item.name === "string"
		&& Number.isSafeInteger(item.size) && item.size >= 0 && attachmentUrl(item.url, channel, item.id))
		.map((item) => ({ id: item.id, name: item.name.slice(0, 1000), size: item.size,
			contentType: item.contentType?.slice(0, 100) ?? "application/octet-stream", url: item.url }));
}

/** Only recover an old filename-only snapshot when Discord still has that exact revision. */
export function sameMessageRevision(row: AssetRow, message: { createdTimestamp: number; editedTimestamp: number | null; content: string; attachments: Iterable<Attachment> }): boolean {
	const timestamp = row.event_type === "message_edited" ? message.editedTimestamp : message.createdTimestamp;
	return timestamp === row.occurred_at.getTime() && (row.event_type !== "message_posted" || !message.editedTimestamp)
		&& (row.content ?? "") === message.content
		&& JSON.stringify(row.metadata.attachmentNames ?? []) === JSON.stringify([...message.attachments].map((item) => item.name));
}

/** Stream to a private temporary file; publish only complete, size-checked bytes. */
export async function downloadAttachment(directory: string, item: SavedAttachment, channel: string,
	request: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
	if (!attachmentUrl(item.url, channel, item.id) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > maxBytes
		|| !/^[a-f0-9]{64}$/.test(item.key)) throw new Error("Invalid attachment");
	const disk = await statfs(directory);
	if (disk.bavail * disk.bsize < item.size + 2 * maxBytes) throw new Error("Attachment storage is full");
	const abort = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
	const response = await request(item.url, { redirect: "error", signal: abort });
	if (!response.ok || !response.body) {
		await response.body?.cancel();
		throw new Error("Attachment download unavailable");
	}
	const length = response.headers.get("content-length");
	if (length !== null && Number(length) !== item.size) {
		await response.body.cancel();
		throw new Error("Attachment size mismatch");
	}
	const temporary = join(directory, `${item.key}.${randomUUID()}.part`);
	const file = await open(temporary, "wx", 0o600);
	const hash = createHash("sha256");
	let bytes = 0;
	try {
		for await (const chunk of response.body) {
			bytes += chunk.length;
			if (bytes > item.size || bytes > maxBytes) throw new Error("Attachment size mismatch");
			hash.update(chunk);
			await file.writeFile(chunk);
		}
		if (bytes !== item.size) throw new Error("Attachment download incomplete");
		await file.sync();
		await file.close();
		await rename(temporary, join(directory, item.key + ".bin"));
		await syncDirectory(directory);
		return hash.digest("hex");
	}
	finally { await file.close(); await rm(temporary, { force: true }); }
}

/** The archive is the durable queue. A bounded circular scan also retries after restarts or replay. */
export class TranscriptionAssets {
	private timer?: NodeJS.Timeout;
	private readonly profiles: TranscriptionProfiles;
	private running?: Promise<void>;
	private cursor: [string, string] = ["1970-01-01T00:00:00.000Z", ""];
	private stopped = false;
	private controller = new AbortController();
	private failed = false;
	private readonly root: string;
	constructor(private readonly client: Client, private readonly database: Pool, directory: string,
		private readonly guildId: string, private readonly log: { warn: (message: string) => void }) {
		if (!id.test(guildId)) throw new Error("Invalid asset guild");
		this.root = join(directory, "assets", guildId);
		this.profiles = new TranscriptionProfiles(client, this.root, guildId, () => this.warn());
	}

	async start(): Promise<void> {
		await mkdir(join(this.root, "events"), { recursive: true, mode: 0o700 });
		await mkdir(join(this.root, "files"), { recursive: true, mode: 0o700 });
		for (const file of await readdir(join(this.root, "files"))) {
			if (/^[a-f0-9]{64}\.[a-f0-9-]{36}\.part$/.test(file)) await rm(join(this.root, "files", file));
		}
		await this.profiles.start();
		this.timer = setInterval(() => { void this.sync(); }, 5_000);
		this.timer.unref();
		void this.sync();
	}

	private warn(): void {
		if (!this.failed) this.log.warn("Transcript media storage will retry; no file contents or download URLs logged.");
		this.failed = true;
	}

	private async message(channelId: string, messageId: string) {
		const channel = await this.client.channels.fetch(channelId);
		if (!channel || !("guildId" in channel) || channel.guildId !== this.guildId || !channel.isTextBased() || !("messages" in channel)) throw new Error("Attachment source unavailable");
		return channel.messages.fetch({ message: messageId, force: true });
	}

	async save(row: AssetRow): Promise<void> {
		if (row.guild_id !== this.guildId || !id.test(row.activity_channel_id) || !id.test(row.message_id) || !eventId.test(row.event_id)) return;
		const path = join(this.root, "events", assetEventKey(this.guildId, row.event_id) + ".json");
		let saved: AssetEvent;
		try { saved = JSON.parse(await readFile(path, "utf8")); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			let items = row.metadata.attachments ?? [];
			if (!items.length) {
				const current = await this.message(row.activity_channel_id, row.message_id).catch((failure: { code?: number }) => {
					if ([10003, 10008, 50001, 50013].includes(failure.code ?? 0)) return undefined;
					throw failure;
				});
				if (current && sameMessageRevision(row, { createdTimestamp: current.createdTimestamp, editedTimestamp: current.editedTimestamp,
					content: current.content, attachments: current.attachments.values() })) items = captureAttachments(current.attachments.values(), row.activity_channel_id);
			}
			saved = { version: 1, eventId: row.event_id, guildId: this.guildId, channelId: row.activity_channel_id,
				messageId: row.message_id, at: row.occurred_at.toISOString(), attachments: items.slice(0, 100).map((item) => ({ ...item,
					key: assetFileKey(this.guildId, row.event_id, item.id), state: "pending", attempts: 0, retryAt: 0 })) };
			// An unavailable legacy snapshot keeps its names in PostgreSQL. Never attach a later revision's bytes.
			await privateJson(path, saved);
		}
		for (const item of saved.attachments) {
			if (this.stopped || item.state !== "pending" || item.retryAt > Date.now()) continue;
			try {
				if (item.attempts) {
					const current = await this.message(saved.channelId, saved.messageId);
					const fresh = current.attachments.get(item.id);
					if (!fresh || fresh.size !== item.size) throw new Error("Attachment no longer available");
					item.url = fresh.url;
				}
				item.sha256 = await downloadAttachment(join(this.root, "files"), item, saved.channelId, fetch, this.controller.signal);
				item.state = "ready";
				item.url = "";
			}
			catch {
				if (this.stopped) return;
				item.attempts++;
				item.retryAt = Date.now() + Math.min(3_600_000, 30_000 * 2 ** item.attempts);
				if (item.attempts >= 12 || item.size > maxBytes) item.state = "unavailable";
				this.warn();
			}
			await privateJson(path, saved);
		}
	}

	sync(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		this.running ??= (async () => {
			const result = await this.database.query<AssetRow & { cursor_at: string }>(`SELECT event_id, guild_id, activity_channel_id, message_id, event_type, occurred_at, content, metadata,
				to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
				FROM discord.transcript_events WHERE guild_id=$1 AND event_type IN ('message_posted','message_edited')
				AND (metadata->'attachmentNames') <> '[]'::jsonb AND (occurred_at,event_id)>($2::timestamptz,$3)
				ORDER BY occurred_at,event_id LIMIT 50`, [this.guildId, ...this.cursor]);
			for (const row of result.rows) {
				if (this.stopped) return;
				await this.save(row).catch(() => this.warn());
				this.cursor = [row.cursor_at, row.event_id];
			}
			if (result.rows.length < 50) this.cursor = ["1970-01-01T00:00:00.000Z", ""];
		})().catch(() => this.warn()).finally(() => { this.running = undefined; });
		return this.running;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		clearInterval(this.timer);
		await this.profiles.stop();
		this.controller.abort();
		await this.running;
	}
}
