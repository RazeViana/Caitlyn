/**
 * @file activityTracker.ts
 * @description Service for tracking user activity in Discord servers.
 * Tracks message counts, voice channel joins, server leaves, and time spent in voice.
 *
 * @module activityTracker
 */

import type { ActivityRow, VoiceSession } from "../types/models.js";
import { pool } from "./createPGPool.js";
import logger from "./logger.js";

interface ActivityQueryResult {
	rows: unknown[];
}

export interface ActivityTrackerDependencies {
	now: () => number;
	query: (text: string, values: unknown[]) => Promise<ActivityQueryResult>;
	sessions: Map<string, VoiceSession>;
}

// Map to track active voice sessions: key = `${guildId}-${userId}`, value = { joinedAt, channelId }
const activeVoiceSessions = new Map<string, VoiceSession>();

const defaultActivityTrackerDependencies: ActivityTrackerDependencies = {
	now: Date.now,
	query: async (text, values) => pool.query(text, values),
	sessions: activeVoiceSessions,
};

/** Track a message from a user. */
async function trackMessage(
	guildId: string,
	userId: string,
	username: string,
	dependencies: ActivityTrackerDependencies = defaultActivityTrackerDependencies,
): Promise<void> {
	try {
		// Increment message count
		await dependencies.query(
			"SELECT discord.increment_message_count($1, $2, $3)",
			[guildId, userId, username],
		);

		// Record daily activity for streak tracking
		await dependencies.query(
			"SELECT discord.record_daily_activity($1, $2, $3)",
			[guildId, userId, username],
		);

		logger.debug(`Tracked message from ${username} in guild ${guildId}`);
	}
	catch (error) {
		logger.error("Error tracking message:", error);
	}
}

/** Track a user joining a voice channel. */
async function trackVoiceJoin(
	guildId: string,
	userId: string,
	username: string,
	channelId: string,
	channelName: string,
	dependencies: ActivityTrackerDependencies = defaultActivityTrackerDependencies,
): Promise<void> {
	try {
		// Increment voice join counter
		await dependencies.query(
			"SELECT discord.increment_voice_join_count($1, $2, $3)",
			[guildId, userId, username],
		);

		// Create voice session record
		const result = await dependencies.query(
			`INSERT INTO discord.voice_sessions
			(guild_id, user_id, username, channel_id, channel_name, joined_at)
			VALUES ($1, $2, $3, $4, $5, NOW())
			RETURNING id`,
			[guildId, userId, username, channelId, channelName],
		);

		// Store session in memory for duration tracking
		const sessionKey = `${guildId}-${userId}`;
		const sessionRow = result.rows[0] as { id: number };
		dependencies.sessions.set(sessionKey, {
			sessionId: sessionRow.id,
			joinedAt: dependencies.now(),
			channelId,
		});

		logger.debug(`Tracked voice join for ${username} in channel ${channelName}`);
	}
	catch (error) {
		logger.error("Error tracking voice join:", error);
	}
}

/** Track a user leaving a voice channel. */
async function trackVoiceLeave(
	guildId: string,
	userId: string,
	username: string,
	dependencies: ActivityTrackerDependencies = defaultActivityTrackerDependencies,
): Promise<void> {
	try {
		const sessionKey = `${guildId}-${userId}`;
		const session = dependencies.sessions.get(sessionKey);

		if (!session) {
			logger.warn(`No active voice session found for ${username}`);
			return;
		}

		// Calculate duration
		const durationMs = dependencies.now() - session.joinedAt;
		const durationSeconds = Math.floor(durationMs / 1000);

		// Update voice session record
		await dependencies.query(
			`UPDATE discord.voice_sessions
			SET left_at = NOW(), duration_seconds = $1
			WHERE id = $2`,
			[durationSeconds, session.sessionId],
		);

		// Add duration to user's total voice time
		await dependencies.query(
			"SELECT discord.add_voice_time($1, $2, $3, $4)",
			[guildId, userId, username, durationSeconds],
		);

		// Record daily voice time for streak tracking
		await dependencies.query(
			"SELECT discord.record_daily_voice_time($1, $2, $3, $4)",
			[guildId, userId, username, durationSeconds],
		);

		// Remove from active sessions
		dependencies.sessions.delete(sessionKey);

		logger.debug(`Tracked voice leave for ${username} (${durationSeconds}s)`);
	}
	catch (error) {
		logger.error("Error tracking voice leave:", error);
	}
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
		return null;
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
		return [];
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
		return [];
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
