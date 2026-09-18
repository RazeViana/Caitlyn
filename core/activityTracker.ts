/**
 * @file activityTracker.ts
 * @description Stores message and voice activity atomically and retrieves activity rankings.
 * Uses persisted voice sessions and per-user transactions; quarantined legacy history is never credited.
 *
 * @module activityTracker
 */

import { pool } from "./createPGPool.js";
import logger from "./logger.js";
import { logData } from "./dataLog.js";
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

async function finishSession(query: Query, guildId: string, userId: string, username: string, at: Date, channelId?: string): Promise<number | undefined> {
	const result = await query(`
		UPDATE discord.voice_sessions
		SET left_at = $3, duration_seconds = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ($3::timestamptz - joined_at))))::bigint
		WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL AND NOT needs_reconciliation
			AND ($4::varchar IS NULL OR channel_id = $4)
		RETURNING duration_seconds
	`, [guildId, userId, at, channelId ?? null]);
	// Do not guess how to merge ambiguous legacy open sessions.
	if (result.rows.length > 1) throw new Error("More than one voice session is marked as active for this user; check the saved sessions before counting voice time");
	for (const row of result.rows) {
		const seconds = Number(row.duration_seconds);
		await query("SELECT discord.add_voice_time($1, $2, $3, $4)", [guildId, userId, username, seconds]);
		await query("SELECT discord.record_daily_voice_time($1, $2, $3, $4)", [guildId, userId, username, seconds]);
		return seconds;
	}
}

async function trackMessage(
	guildId: string, userId: string, username: string, dependencies = defaultActivityTrackerDependencies,
	source?: { channelId: string; messageId: string },
): Promise<void> {
	await dependencies.transaction(async (query) => {
		await lockUser(query, guildId, userId);
		await query("SELECT discord.increment_message_count($1, $2, $3)", [guildId, userId, username]);
		await query("SELECT discord.record_daily_activity($1, $2, $3)", [guildId, userId, username]);
	});
	logData("Saved message activity; message total and daily activity updated", {
		server: guildId, channel: source?.channelId, message: source?.messageId, user: userId, username,
		fields: "user ID, username, message count, activity day and streak",
	});
}

async function trackVoiceJoin(
	guildId: string, userId: string, username: string, channelId: string, channelName: string,
	dependencies = defaultActivityTrackerDependencies,
): Promise<void> {
	const at = new Date(dependencies.now());
	const result = await dependencies.transaction(async (query) => {
		await lockUser(query, guildId, userId);
		const open = await query("SELECT channel_id FROM discord.voice_sessions WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL AND NOT needs_reconciliation FOR UPDATE", [guildId, userId]);
		if (open.rows.length > 1) throw new Error("More than one voice session is marked as active for this user; check the saved sessions before counting voice time");
		if (open.rows[0]?.channel_id === channelId) return { existing: true };
		const seconds = await finishSession(query, guildId, userId, username, at);
		await query("SELECT discord.increment_voice_join_count($1, $2, $3)", [guildId, userId, username]);
		await query(`INSERT INTO discord.voice_sessions
			(guild_id, user_id, username, channel_id, channel_name, joined_at)
			VALUES ($1, $2, $3, $4, $5, $6)`, [guildId, userId, username, channelId, channelName, at]);
		return { existing: false, seconds };
	});
	logData(result.existing ? "Voice session already saved; join not counted again" : "Saved voice join and started counting time in the channel", {
		server: guildId, user: userId, username, channel: channelId, channelName, seconds: result.seconds,
		fields: result.existing ? "existing voice session" : "user ID, username, channel ID and name, join time and join count",
	});
}

async function trackVoiceLeave(
	guildId: string, userId: string, username: string,
	dependencies = defaultActivityTrackerDependencies, channelId?: string,
): Promise<void> {
	const at = new Date(dependencies.now());
	const seconds = await dependencies.transaction(async (query) => {
		await lockUser(query, guildId, userId);
		return finishSession(query, guildId, userId, username, at, channelId);
	});
	logData(seconds === undefined ? "No saved voice session to close; no time added" : "Saved voice leave; total and daily voice time updated", {
		server: guildId, user: userId, username, channel: channelId, seconds,
		fields: seconds === undefined ? "none" : "leave time, session length, total and daily voice time",
	});
}

/** Get activity stats for a user. */
async function getUserActivity(guildId: string, userId: string): Promise<ActivityRow | null> {
	try {
		const result = await pool.query<ActivityRow>(
			"SELECT * FROM discord.get_user_activity($1, $2)",
			[guildId, userId],
		);

		logData("Read saved user activity", { server: guildId, user: userId, count: result.rows.length });
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
		logData("Read saved activity rankings", { server: guildId, count: result.rows.length });
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
		logData("Read saved streak rankings", { server: guildId, count: result.rows.length });
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
