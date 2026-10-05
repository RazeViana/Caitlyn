/**
 * @file transcriptionRetention.ts
 * @description Applies an explicitly configured retention period to database rows and private daily files with replay protection.
 * @module transcriptionRetention
 */

import { readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";
import { transcriptDay } from "./transcriptionStore.js";
import { syncDirectory } from "./transcriptionFiles.js";
import { assetFileKey } from "./transcriptionAssets.js";

export async function expireTranscripts(database: Pool, directory: string, guildId: string, timezone: string, days: number, now = Date.now()): Promise<number> {
	if (!Number.isInteger(days) || days < 0 || days > 36500) throw new Error("Invalid retention period");
	if (!days) return 0;
	if (!/^[1-9]\d{0,19}$/.test(guildId)) throw new Error("Invalid retention guild");
	// Expire complete local calendar days only, keeping at least the chosen duration.
	const cutoffDay = transcriptDay(now - days * 86_400_000, timezone);
	const connection = await database.connect();
	let broken = false;
	let count: number;
	try {
		await connection.query("BEGIN");
		await connection.query("SELECT pg_advisory_xact_lock(hashtext('caitlyn-retention'), hashtext($1))", [guildId]);
		await connection.query(`INSERT INTO discord.transcript_retention (guild_id, deleted_before)
			VALUES ($1, $2::date::timestamp AT TIME ZONE $3) ON CONFLICT (guild_id) DO UPDATE
			SET deleted_before = GREATEST(discord.transcript_retention.deleted_before, EXCLUDED.deleted_before), updated_at = NOW()`, [guildId, cutoffDay, timezone]);
		const result = await connection.query(`DELETE FROM discord.transcript_events e USING discord.transcript_retention t
			WHERE e.guild_id = $1 AND t.guild_id = e.guild_id AND e.occurred_at < t.deleted_before`, [guildId]);
		count = result.rowCount ?? 0;
		await connection.query("COMMIT");
	}
	catch (error) {
		try { await connection.query("ROLLBACK"); }
		catch { broken = true; }
		throw error;
	}
	finally { connection.release(broken); }
	// DB deletion and its replay fence commit first. Failed file cleanup can safely retry.
	const entries = async (path: string) => readdir(path, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return [];
		throw error;
	});
	for (const root of [join(directory, guildId), join(directory, "quarantine", guildId)]) {
		for (const channel of await entries(root)) {
			if (!channel.isDirectory() || !/^[1-9]\d{0,19}$/.test(channel.name)) continue;
			const path = join(root, channel.name);
			for (const file of await entries(path)) {
				if (!file.isFile()) continue;
				let day = /^(\d{4}-\d{2}-\d{2})\.(?:jsonl|txt)$/.exec(file.name)?.[1];
				if (root.includes("/quarantine/") && /^[a-f0-9]{64}\.json$/.test(file.name)) {
					const value = JSON.parse(await readFile(join(path, file.name), "utf8"));
					day = /\/(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(value.source)?.[1];
				}
				if (day && day < cutoffDay) await unlink(join(path, file.name));
			}
			await syncDirectory(path);
		}
	}
	// Media files belong to individual immutable events. Only remove them after
	// their event is gone and below the committed retention fence.
	const assetRoot = join(directory, "assets", guildId);
	for (const file of await entries(join(assetRoot, "events"))) {
		if (!file.isFile() || !/^[a-f0-9]{64}\.json$/.test(file.name)) continue;
		const path = join(assetRoot, "events", file.name);
		const saved = JSON.parse(await readFile(path, "utf8"));
		if (saved.guildId !== guildId || !Number.isFinite(Date.parse(saved.at)) || transcriptDay(saved.at, timezone) >= cutoffDay) continue;
		const existing = await database.query("SELECT 1 FROM discord.transcript_events WHERE event_id=$1", [saved.eventId]);
		if (existing.rows.length) continue;
		for (const item of saved.attachments ?? []) {
			if (/^[1-9]\d{0,19}$/.test(item.id) && item.key === assetFileKey(guildId, saved.eventId, item.id)) {
				await unlink(join(assetRoot, "files", item.key + ".bin")).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
			}
		}
		await unlink(path);
		await syncDirectory(join(assetRoot, "events"));
		await syncDirectory(join(assetRoot, "files"));
	}
	return count;
}
