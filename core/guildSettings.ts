/**
 * @file guildSettings.ts
 * @description Persists the operator's single main-server log destination and selected levels.
 * Serializes changes and keeps the main-server reservation when forwarding is disabled.
 *
 * @module guildSettings
 */

import { pool } from "./createPGPool.js";
import { withTransaction } from "./transaction.js";
import { validLogTypes, type LogType } from "./logLevels.js";

export interface GuildLogSettings {
	guild_id: string;
	log_channel_id: string | null;
	log_scope: "server" | "console";
	log_levels: LogType[];
}

export function createGuildSettingsStore(database = pool) {
	return {
		async list(): Promise<GuildLogSettings[]> {
			const result = await database.query<GuildLogSettings>("SELECT guild_id, log_channel_id, log_scope, log_levels FROM discord.guild_settings WHERE log_scope = 'console'");
			return result.rows;
		},
		async getMain(): Promise<GuildLogSettings | undefined> {
			const result = await database.query<GuildLogSettings>("SELECT guild_id, log_channel_id, log_scope, log_levels FROM discord.guild_settings WHERE log_scope = 'console'");
			return result.rows[0];
		},
		async save(guildId: string, channelId: string | null, operator: boolean): Promise<GuildLogSettings> {
			if (!operator) throw new Error("Only the bot application owner can configure logging");
			if (!/^[1-9]\d*$/.test(guildId) || (channelId !== null && !/^[1-9]\d*$/.test(channelId))) {
				throw new Error("Invalid server or channel ID");
			}
			return withTransaction(async (query) => {
				await query("SELECT pg_advisory_xact_lock(hashtextextended('caitlyn-log-settings', 0))");
				const destination = await query("SELECT guild_id FROM discord.guild_settings WHERE log_scope = 'console'");
				if (destination.rows.length && destination.rows[0].guild_id !== guildId) throw new Error("Logging is restricted to the configured main server");
				if (!destination.rows.length && channelId === null) throw new Error("Logging has not been configured");
				const result = await query(`INSERT INTO discord.guild_settings (guild_id, log_channel_id, log_scope)
					VALUES ($1, $2, 'console') ON CONFLICT (guild_id) DO UPDATE
					SET log_channel_id = EXCLUDED.log_channel_id, log_scope = EXCLUDED.log_scope, updated_at = NOW()
					RETURNING guild_id, log_channel_id, log_scope, log_levels`, [guildId, channelId]);
				return result.rows[0] as unknown as GuildLogSettings;
			}, database);
		},
		async setLevels(guildId: string, channelId: string, levels: LogType[], operator: boolean): Promise<GuildLogSettings> {
			if (!operator) throw new Error("Only the bot application owner can change log levels");
			if (!validLogTypes(levels)) throw new Error("Invalid log level selection");
			return withTransaction(async (query) => {
				await query("SELECT pg_advisory_xact_lock(hashtextextended('caitlyn-log-settings', 0))");
				const result = await query(`UPDATE discord.guild_settings SET log_levels = $3, updated_at = NOW()
					WHERE guild_id = $1 AND log_channel_id = $2 AND log_scope = 'console'
					RETURNING guild_id, log_channel_id, log_scope, log_levels`, [guildId, channelId, levels]);
				if (!result.rows.length) throw new Error("Run this command inside the configured logging channel");
				return result.rows[0] as unknown as GuildLogSettings;
			}, database);
		},
	};
}

export const guildSettings = createGuildSettingsStore();
