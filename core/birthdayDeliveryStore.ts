/**
 * @file birthdayDeliveryStore.ts
 * @description Persists grouped birthday deliveries and unique annual recipient reservations.
 * Uses short transactions and conditional claims; no transaction spans a Discord request.
 *
 * @module birthdayDeliveryStore
 */

import { randomUUID } from "node:crypto";
import { pool } from "./createPGPool.js";
import { withTransaction } from "./transaction.js";

export interface BirthdayDelivery {
	id: string;
	guild_id: string;
	channel_id: string;
	occurrence_date: string;
	status: "ready" | "sending" | "uncertain" | "sent" | "expired";
	attempts: number;
	started_at: Date | null;
	recipient_ids: string[];
}

export function createBirthdayDeliveryStore(database = pool) {
	return {
		async prepare(guildId: string, channelId: string, date: string): Promise<{ created: number; expired: number }> {
			return withTransaction(async (query) => {
				const lock = await query("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired", [`birthday:${guildId}`]);
				if (!lock.rows[0].acquired) return { created: 0, expired: 0 };
				const expired = await query(`UPDATE discord.birthday_deliveries SET status = 'expired', updated_at = NOW()
					WHERE guild_id = $1 AND occurrence_date < $2::date AND status = 'ready' RETURNING id`, [guildId, date]);
				const people = await query(`SELECT b.discord_id::text FROM discord.birthdays b
					WHERE to_char(b.dob, 'MM-DD') = to_char($2::date, 'MM-DD') AND b.discord_id > 0
					AND NOT EXISTS (SELECT 1 FROM discord.birthday_occurrences o
						WHERE o.guild_id = $1 AND o.discord_id = b.discord_id::text AND o.occurrence_date = $2::date)
					ORDER BY b.discord_id LIMIT 500`, [guildId, date]);
				for (let index = 0; index < people.rows.length; index += 25) {
					const id = randomUUID();
					const recipients = people.rows.slice(index, index + 25).map((person) => person.discord_id);
					await query(`INSERT INTO discord.birthday_deliveries (id, guild_id, channel_id, occurrence_date)
						VALUES ($1, $2, $3, $4::date)`, [id, guildId, channelId, date]);
					await query(`INSERT INTO discord.birthday_occurrences (guild_id, discord_id, occurrence_date, delivery_id)
						SELECT $1, recipient, $2::date, $3::uuid FROM unnest($4::text[]) AS recipient`, [guildId, date, id, recipients]);
				}
				return { created: people.rows.length, expired: expired.rows.length };
			}, database);
		},
		async pending(guildId: string, date: string): Promise<BirthdayDelivery[]> {
			const result = await database.query<BirthdayDelivery>(`SELECT d.id, d.guild_id, d.channel_id,
				d.occurrence_date::text, d.status, d.attempts, d.started_at, array_agg(o.discord_id ORDER BY o.discord_id) AS recipient_ids
				FROM discord.birthday_deliveries d JOIN discord.birthday_occurrences o ON o.delivery_id = d.id
				WHERE d.guild_id = $1 AND d.occurrence_date = $2::date AND d.status IN ('ready', 'sending', 'uncertain')
				AND d.next_attempt_at <= NOW() GROUP BY d.id ORDER BY d.next_attempt_at, d.id LIMIT 20`, [guildId, date]);
			return result.rows;
		},
		async claim(id: string): Promise<boolean> {
			const result = await database.query(`UPDATE discord.birthday_deliveries
				SET status = 'sending', attempts = attempts + 1, started_at = NOW(), updated_at = NOW(), next_attempt_at = NOW() + INTERVAL '2 minutes'
				WHERE id = $1 AND status = 'ready' AND next_attempt_at <= NOW() RETURNING id`, [id]);
			return result.rows.length === 1;
		},
		async claimRecovery(id: string): Promise<boolean> {
			const result = await database.query(`UPDATE discord.birthday_deliveries
				SET status = 'uncertain', updated_at = NOW(), next_attempt_at = NOW() + INTERVAL '15 minutes'
				WHERE id = $1 AND status IN ('sending', 'uncertain') AND next_attempt_at <= NOW() RETURNING id`, [id]);
			return result.rows.length === 1;
		},
		async sent(id: string, messageId: string): Promise<boolean> {
			const result = await database.query(`UPDATE discord.birthday_deliveries SET status = 'sent', message_id = $2, updated_at = NOW()
				WHERE id = $1 AND status IN ('sending', 'uncertain') RETURNING id`, [id, messageId]);
			return result.rows.length === 1;
		},
		async defer(id: string): Promise<void> {
			await database.query(`UPDATE discord.birthday_deliveries SET attempts = attempts + 1, updated_at = NOW(),
				next_attempt_at = NOW() + LEAST(60, 5 * power(2, LEAST(attempts, 4))) * INTERVAL '1 minute'
				WHERE id = $1 AND status = 'ready'`, [id]);
		},
		async uncertain(id: string): Promise<void> {
			await database.query(`UPDATE discord.birthday_deliveries SET status = 'uncertain', updated_at = NOW(),
				next_attempt_at = NOW() + INTERVAL '5 minutes' WHERE id = $1 AND status = 'sending'`, [id]);
		},
		async releaseUnsent(id: string): Promise<void> {
			await database.query(`UPDATE discord.birthday_deliveries SET status = 'ready', started_at = NULL,
				next_attempt_at = NOW(), updated_at = NOW() WHERE id = $1 AND status IN ('sending', 'uncertain')`, [id]);
		},
	};
}

export type BirthdayDeliveryStore = ReturnType<typeof createBirthdayDeliveryStore>;
export const birthdayDeliveryStore = createBirthdayDeliveryStore();
