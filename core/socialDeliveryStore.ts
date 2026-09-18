/**
 * @file socialDeliveryStore.ts
 * @description Persists channel opt-ins and bounded social jobs with leased, conditional state transitions.
 * Never holds a database transaction while contacting Discord or a media worker.
 *
 * @module socialDeliveryStore
 */

import { randomUUID } from "node:crypto";
import { pool } from "./createPGPool.js";
import { withTransaction } from "./transaction.js";
import type { SocialChannelSetting, SocialJob } from "../types/socialDelivery.js";
import { parseSocialLink } from "./socialLinks.js";
import { logData } from "./dataLog.js";

type NewSocialJob = Pick<SocialJob, "guild_id" | "channel_id" | "source_id" | "author_id" | "source_hash" | "post_id" | "url">;

export function createSocialDeliveryStore(database = pool) {
	return {
		async settings(guildId: string): Promise<SocialChannelSetting[]> {
			return (await database.query<SocialChannelSetting>("SELECT channel_id, enabled FROM discord.social_channels WHERE guild_id = $1 ORDER BY channel_id LIMIT 100", [guildId])).rows;
		},
		async enabled(guildId: string, channelId: string): Promise<boolean> {
			return (await database.query("SELECT 1 FROM discord.social_channels WHERE guild_id = $1 AND channel_id = $2 AND enabled", [guildId, channelId])).rows.length === 1;
		},
		async configure(guildId: string, channelId: string | null, enabled: boolean): Promise<void> {
			if (!/^[1-9]\d{0,24}$/.test(guildId) || (channelId !== null && !/^[1-9]\d{0,24}$/.test(channelId)) || (enabled && !channelId)) throw new Error("invalid_social_configuration");
			await withTransaction(async (query) => {
				await query("SELECT pg_advisory_xact_lock(hashtextextended('caitlyn-social-settings', 0))");
				if (channelId !== null) {
					const count = await query("SELECT COUNT(*)::int AS count FROM discord.social_channels WHERE guild_id = $1 AND channel_id <> $2", [guildId, channelId]);
					if (Number(count.rows[0].count) >= 100) throw new Error("social_channel_limit");
					await query(`INSERT INTO discord.social_channels (guild_id, channel_id, enabled) VALUES ($1, $2, $3)
						ON CONFLICT (guild_id, channel_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`, [guildId, channelId, enabled]);
				}
				else {await query("UPDATE discord.social_channels SET enabled = FALSE, updated_at = NOW() WHERE guild_id = $1", [guildId]);}
				if (!enabled) {
					await query(`UPDATE discord.social_jobs SET cancel_requested = TRUE, updated_at = NOW(),
						status = CASE WHEN status IN ('queued', 'processing') THEN 'cancelled' ELSE status END
						WHERE guild_id = $1 AND ($2::text IS NULL OR channel_id = $2) AND status IN ('queued', 'processing', 'sending', 'uncertain')`, [guildId, channelId]);
				}
			}, database);
		},
		async enqueue(job: NewSocialJob): Promise<boolean> {
			return withTransaction(async (query) => {
				const lock = await query("SELECT pg_try_advisory_xact_lock(hashtextextended('caitlyn-social-enqueue', 0)) AS acquired");
				if (!lock.rows[0].acquired) return false;
				const count = await query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE guild_id = $1)::int AS guild
					FROM discord.social_jobs WHERE status IN ('queued', 'processing', 'sending', 'uncertain', 'removing')`, [job.guild_id]);
				if (Number(count.rows[0].total) >= 1_000 || Number(count.rows[0].guild) >= 100) return false;
				const result = await query(`INSERT INTO discord.social_jobs (id, guild_id, channel_id, source_id, author_id, source_hash, post_id, url, source_cleanup)
					SELECT $1, $2, $3, $4, $5, $6, $7, $8, 'pending' WHERE EXISTS
					(SELECT 1 FROM discord.social_channels WHERE guild_id = $2 AND channel_id = $3 AND enabled)
					ON CONFLICT (guild_id, channel_id, source_id, post_id) DO NOTHING RETURNING id`,
				[randomUUID(), job.guild_id, job.channel_id, job.source_id, job.author_id, job.source_hash, job.post_id, job.url]);
				return result.rows.length === 1;
			}, database);
		},
		async claim(): Promise<SocialJob | undefined> {
			return withTransaction(async (query) => {
				await query(`UPDATE discord.social_jobs SET status = 'failed', last_outcome = 'expired', updated_at = NOW()
					WHERE status IN ('queued', 'processing') AND (expires_at <= NOW() OR (attempts >= 3 AND next_attempt_at <= NOW()))`);
				// Keep uncertain sends for manual review; never erase the evidence needed to prevent retries.
				await query("DELETE FROM discord.social_jobs WHERE status IN ('sent', 'failed', 'cancelled') AND created_at < NOW() - INTERVAL '30 days'");
				const selected = await query(`SELECT id FROM discord.social_jobs WHERE status IN ('queued', 'processing', 'sending', 'uncertain', 'removing', 'sent')
					AND next_attempt_at <= NOW() ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
				if (!selected.rows.length) return;
				const result = await query(`UPDATE discord.social_jobs SET
					status = CASE WHEN status IN ('queued', 'processing') THEN 'processing' WHEN status = 'sending' THEN 'uncertain' ELSE status END,
					attempts = attempts + CASE WHEN status IN ('queued', 'processing') THEN 1 ELSE 0 END,
					lease_token = $2, next_attempt_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
					WHERE id = $1 RETURNING *`, [selected.rows[0].id, randomUUID()]);
				return result.rows[0] as unknown as SocialJob;
			}, database);
		},
		async beginSend(job: SocialJob, complete = false, sensitive = false): Promise<boolean> {
			const result = await database.query(`UPDATE discord.social_jobs SET status = 'sending', replacement_ready = $3, sensitive = $4, next_attempt_at = NOW() + INTERVAL '2 minutes', updated_at = NOW()
				WHERE id = $1 AND lease_token = $2 AND status = 'processing' AND NOT cancel_requested AND expires_at > NOW()
				AND next_attempt_at > NOW() AND EXISTS (SELECT 1 FROM discord.social_channels c
					WHERE c.guild_id = social_jobs.guild_id AND c.channel_id = social_jobs.channel_id AND c.enabled) RETURNING id`, [job.id, job.lease_token, complete, sensitive]);
			return result.rows.length === 1;
		},
		async sent(job: SocialJob, messageId: string): Promise<void> {
			await database.query(`UPDATE discord.social_jobs SET status = CASE WHEN cancel_requested THEN 'removing' ELSE 'sent' END,
				message_id = $3, next_attempt_at = NOW(), updated_at = NOW() WHERE id = $1 AND lease_token = $2 AND status IN ('sending', 'uncertain')`, [job.id, job.lease_token, messageId]);
		},
		async finish(job: SocialJob, status: "failed" | "cancelled" | "queued" | "uncertain" | "removing" | "sent", outcome: string): Promise<void> {
			await database.query(`UPDATE discord.social_jobs SET status = $3, last_outcome = $4, updated_at = NOW(),
				next_attempt_at = NOW() + CASE WHEN $3 IN ('uncertain', 'removing', 'sent') THEN INTERVAL '15 minutes' ELSE INTERVAL '1 minute' END
				WHERE id = $1 AND lease_token = $2 AND (
					($3 IN ('queued', 'failed') AND status = 'processing') OR
					($3 = 'cancelled' AND status IN ('processing', 'removing')) OR
					($3 = 'uncertain' AND status IN ('processing', 'sending', 'uncertain')) OR
					($3 = 'removing' AND status IN ('sent', 'removing') AND source_cleanup NOT IN ('deleting', 'deleted')) OR
					($3 = 'sent' AND status = 'sent'))`, [job.id, job.lease_token, status, outcome]);
		},
		async beginSourceDelete(job: SocialJob, postIds: string[]): Promise<boolean> {
			return withTransaction(async (query) => {
				const enabled = await query("SELECT 1 FROM discord.social_channels WHERE guild_id = $1 AND channel_id = $2 AND enabled", [job.guild_id, job.channel_id]);
				if (!enabled.rows.length) return false;
				const result = await query("SELECT * FROM discord.social_jobs WHERE guild_id = $1 AND channel_id = $2 AND source_id = $3 ORDER BY id FOR UPDATE", [job.guild_id, job.channel_id, job.source_id]);
				const jobs = result.rows as unknown as SocialJob[];
				const current = jobs.find((item) => item.id === job.id && item.lease_token === job.lease_token);
				if (!current || !jobs.length || new Set(postIds).size !== jobs.length || jobs.some((item) =>
					!postIds.includes(item.post_id) || item.source_hash !== job.source_hash || item.author_id !== job.author_id
					|| item.status !== "sent" || !item.message_id || !item.replacement_ready || item.cancel_requested || item.source_cleanup !== "pending")) return false;
				await query(`UPDATE discord.social_jobs SET source_cleanup = 'deleting', next_attempt_at = NOW() + INTERVAL '5 minutes', updated_at = NOW()
					WHERE guild_id = $1 AND channel_id = $2 AND source_id = $3`, [job.guild_id, job.channel_id, job.source_id]);
				return true;
			}, database);
		},
		/** Bind an opaque share to its canonical video, reusing only a confirmed complete sibling. */
		async resolveTikTok(job: SocialJob, url: string): Promise<"send" | "reused" | "blocked" | "stale"> {
			const resolved = parseSocialLink(url);
			if (resolved?.platform !== "tiktok" || resolved.kind !== "post" || resolved.url !== url || !url.includes("/video/")) throw new Error("invalid_tiktok_resolution");
			return withTransaction(async (query) => {
				const rows = await query("SELECT * FROM discord.social_jobs WHERE guild_id = $1 AND channel_id = $2 AND source_id = $3 ORDER BY id FOR UPDATE", [job.guild_id, job.channel_id, job.source_id]);
				const jobs = rows.rows as unknown as SocialJob[];
				const current = jobs.find((item) => item.id === job.id && item.lease_token === job.lease_token);
				if (!current || current.status !== "processing" || current.cancel_requested || current.source_hash !== job.source_hash || current.author_id !== job.author_id) return "stale";
				const original = parseSocialLink(current.url);
				if (original?.platform !== "tiktok" || (original.kind === "post" && original.id !== resolved.id)) throw new Error("invalid_tiktok_resolution");
				const sibling = jobs.find((item) => item.id !== job.id && parseSocialLink(item.url)?.key === resolved.key
					&& ["processing", "sending", "uncertain", "sent", "removing"].includes(item.status));
				if (sibling) {
					if (sibling.status !== "sent" || !sibling.message_id || !sibling.replacement_ready || sibling.cancel_requested
						|| sibling.source_hash !== job.source_hash || sibling.author_id !== job.author_id || sibling.source_cleanup !== "pending") return "blocked";
					await query(`UPDATE discord.social_jobs SET url = $3, status = 'sent', message_id = $4, replacement_ready = TRUE,
						next_attempt_at = NOW(), last_outcome = 'duplicate_reused', updated_at = NOW() WHERE id = $1 AND lease_token = $2`,
					[job.id, job.lease_token, url, sibling.message_id]);
					return "reused";
				}
				await query("UPDATE discord.social_jobs SET url = $3, updated_at = NOW() WHERE id = $1 AND lease_token = $2", [job.id, job.lease_token, url]);
				return "send";
			}, database);
		},
		async sourceReplacements(job: SocialJob): Promise<SocialJob[]> {
			return (await database.query<SocialJob>("SELECT * FROM discord.social_jobs WHERE guild_id = $1 AND channel_id = $2 AND source_id = $3 ORDER BY id", [job.guild_id, job.channel_id, job.source_id])).rows;
		},
		async finishSourceDelete(job: SocialJob, outcome: "deleted" | "retained"): Promise<void> {
			await database.query(`UPDATE discord.social_jobs SET source_cleanup = $4, last_outcome = $5, updated_at = NOW(), next_attempt_at = NOW() + INTERVAL '15 minutes'
				WHERE guild_id = $1 AND channel_id = $2 AND source_id = $3 AND source_cleanup IN ('pending', 'deleting')
				AND EXISTS (SELECT 1 FROM discord.social_jobs current WHERE current.id = $6 AND current.lease_token = $7 AND current.status = 'sent')`,
			[job.guild_id, job.channel_id, job.source_id, outcome, `source_${outcome}`, job.id, job.lease_token]);
		},
		async cancelSource(guildId: string, channelId: string, sourceId: string): Promise<void> {
			const result = await database.query(`UPDATE discord.social_jobs SET cancel_requested = TRUE, updated_at = NOW(),
				status = CASE WHEN status IN ('queued', 'processing') THEN 'cancelled' WHEN status = 'sent' THEN 'removing' ELSE status END,
				next_attempt_at = CASE WHEN status = 'sent' THEN NOW() ELSE next_attempt_at END
				WHERE guild_id = $1 AND channel_id = $2 AND source_id = $3 AND source_cleanup NOT IN ('deleting', 'deleted')`, [guildId, channelId, sourceId]);
			if (result.rowCount) {
				logData("Saved requests to stop or remove linked social previews", {
					server: guildId, channel: channelId, message: sourceId, count: result.rowCount,
				});
			}
		},
	};
}

export type SocialDeliveryStore = ReturnType<typeof createSocialDeliveryStore>;
export const socialDeliveryStore = createSocialDeliveryStore();
