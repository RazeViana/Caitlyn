/**
 * @file activityTracker.ts
 * @description Stores message and voice activity atomically and retrieves activity rankings.
 * Uses persisted voice sessions and per-user transactions to prevent duplicate completion totals.
 *
 * @module activityTracker
 */

import { pool } from "./createPGPool.js";
import logger from "./logger.js";
import { withTransaction, type Query } from "./transaction.js";
import type { ActivityRow } from "../types/models.js";

export interface ActivityTrackerDependencies {
	now: () => number;
	transaction: typeof withTransaction;
}

const defaultActivityTrackerDependencies: ActivityTrackerDependencies = {
	now: Date.now,
	transaction: withTransaction,
};

async function lockUser(query: Query, guildId: string, userId: string): Promise<void> {
	await query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`activity:${guildId}:${userId}`]);
}

async function finishSession(query: Query, guildId: string, userId: string, username: string, at: Date, channelId?: string): Promise<void> {
	const result = await query(`
		UPDATE discord.voice_sessions
		SET left_at = $3, duration_seconds = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($3::timestamptz - joined_at))))::bigint
		WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL
			AND ($4::varchar IS NULL OR channel_id = $4)
		RETURNING duration_seconds
	`, [guildId, userId, at, channelId ?? null]);
	// Do not guess how to merge ambiguous legacy open sessions.
	if (result.rows.length > 1) throw new Error("Multiple open voice sessions need reconciliation");
	for (const row of result.rows) {
		const seconds = Number(row.duration_seconds);
		await query("SELECT discord.add_voice_time($1, $2, $3, $4)", [guildId, userId, username, seconds]);
		await query("SELECT discord.record_daily_voice_time($1, $2, $3, $4)", [guildId, userId, username, seconds]);
	}
}

async function trackMessage(guildId: string, userId: string, username: string, dependencies = defaultActivityTrackerDependencies): Promise<void> {
	await dependencies.transaction(async (query) => {
		await lockUser(query, guildId, userId);
		await query("SELECT discord.increment_message_count($1, $2, $3)", [guildId, userId, username]);
		await query("SELECT discord.record_daily_activity($1, $2, $3)", [guildId, userId, username]);
	});
}

async function trackVoiceJoin(
	guildId: string, userId: string, username: string, channelId: string, channelName: string,
	dependencies = defaultActivityTrackerDependencies,
): Promise<void> {
	const at = new Date(dependencies.now());
	await dependencies.transaction(async (query) => {
		await lockUser(query, guildId, userId);
		const open = await query("SELECT channel_id FROM discord.voice_sessions WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL FOR UPDATE", [guildId, userId]);
		if (open.rows.length > 1) throw new Error("Multiple open voice sessions need reconciliation");
		if (open.rows[0]?.channel_id === channelId) return;
		await finishSession(query, guildId, userId, username, at);
		await query("SELECT discord.increment_voice_join_count($1, $2, $3)", [guildId, userId, username]);
		await query(`INSERT INTO discord.voice_sessions
			(guild_id, user_id, username, channel_id, channel_name, joined_at)
			VALUES ($1, $2, $3, $4, $5, $6)`, [guildId, userId, username, channelId, channelName, at]);
	});
}

async function trackVoiceLeave(
	guildId: string, userId: string, username: string,
	dependencies = defaultActivityTrackerDependencies, channelId?: string,
): Promise<void> {
	const at = new Date(dependencies.now());
	await dependencies.transaction(async (query) => {
		await lockUser(query, guildId, userId);
		await finishSession(query, guildId, userId, username, at, channelId);
	});
}

/** Get activity stats for a user. */
async function getUserActivity(guildId: string, userId: string): Promise<ActivityRow | null> {
	try {
		const result = await pool.query<ActivityRow>(
			"SELECT * FROM discord.get_user_activity($1, $2)",
			[guildId, userId],
		);

		if (result.rows.length === 0) {
			return null;
		}

		return result.rows[0];
	}
	catch (error) {
		logger.error("Error getting user activity:", error);
		throw error;
	}
}

/** Get top active users in a guild. */
async function getTopActiveUsers(guildId: string, limit = 10): Promise<ActivityRow[]> {
	try {
		const result = await pool.query<ActivityRow>(
			"SELECT * FROM discord.get_top_active_users($1, $2)",
			[guildId, limit],
		);

		return result.rows;
	}
	catch (error) {
		logger.error("Error getting top active users:", error);
		throw error;
	}
}

/** Get top users by longest streak in a guild. */
async function getTopStreakUsers(guildId: string, limit = 10): Promise<ActivityRow[]> {
	try {
		const result = await pool.query<ActivityRow>(
			"SELECT * FROM discord.get_top_streak_users($1, $2)",
			[guildId, limit],
		);

		return result.rows;
	}
	catch (error) {
		logger.error("Error getting top streak users:", error);
		throw error;
	}
}

/** Format duration in seconds to human-readable text. */
function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

	return parts.join(" ");
}

export {
	trackMessage,
	trackVoiceJoin,
	trackVoiceLeave,
	getUserActivity,
	getTopActiveUsers,
	getTopStreakUsers,
	formatDuration,
};
