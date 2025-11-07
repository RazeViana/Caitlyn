/**
 * @file activityTracker.js
 * @description Service for tracking user activity in Discord servers.
 * Tracks message counts, voice channel joins, server leaves, and time spent in voice.
 *
 * @module activityTracker
 */

import { pool } from "./createPGPool.js";
import logger from "./logger.js";

// Map to track active voice sessions: key = `${guildId}-${userId}`, value = { joinedAt, channelId }
const activeVoiceSessions = new Map();

/**
 * Track a message from a user
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} username - Username
 */
async function trackMessage(guildId, userId, username) {
	try {
		// Increment message count
		await pool.query(
			"SELECT discord.increment_message_count($1, $2, $3)",
			[guildId, userId, username]
		);

		// Record daily activity for streak tracking
		await pool.query(
			"SELECT discord.record_daily_activity($1, $2, $3)",
			[guildId, userId, username]
		);

		logger.debug(`Tracked message from ${username} in guild ${guildId}`);
	} catch (error) {
		logger.error("Error tracking message:", error);
	}
}

/**
 * Track a user joining a voice channel
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} username - Username
 * @param {string} channelId - Voice channel ID
 * @param {string} channelName - Voice channel name
 */
async function trackVoiceJoin(guildId, userId, username, channelId, channelName) {
	try {
		// Increment voice join counter
		await pool.query(
			"SELECT discord.increment_voice_join_count($1, $2, $3)",
			[guildId, userId, username]
		);

		// Create voice session record
		const result = await pool.query(
			`INSERT INTO discord.voice_sessions
			(guild_id, user_id, username, channel_id, channel_name, joined_at)
			VALUES ($1, $2, $3, $4, $5, NOW())
			RETURNING id`,
			[guildId, userId, username, channelId, channelName]
		);

		// Store session in memory for duration tracking
		const sessionKey = `${guildId}-${userId}`;
		activeVoiceSessions.set(sessionKey, {
			sessionId: result.rows[0].id,
			joinedAt: Date.now(),
			channelId,
		});

		logger.debug(`Tracked voice join for ${username} in channel ${channelName}`);
	} catch (error) {
		logger.error("Error tracking voice join:", error);
	}
}

/**
 * Track a user leaving a voice channel
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @param {string} username - Username
 */
async function trackVoiceLeave(guildId, userId, username) {
	try {
		const sessionKey = `${guildId}-${userId}`;
		const session = activeVoiceSessions.get(sessionKey);

		if (!session) {
			logger.warn(`No active voice session found for ${username}`);
			return;
		}

		// Calculate duration
		const durationMs = Date.now() - session.joinedAt;
		const durationSeconds = Math.floor(durationMs / 1000);

		// Update voice session record
		await pool.query(
			`UPDATE discord.voice_sessions
			SET left_at = NOW(), duration_seconds = $1
			WHERE id = $2`,
			[durationSeconds, session.sessionId]
		);

		// Add duration to user's total voice time
		await pool.query(
			"SELECT discord.add_voice_time($1, $2, $3, $4)",
			[guildId, userId, username, durationSeconds]
		);

		// Record daily voice time for streak tracking
		await pool.query(
			"SELECT discord.record_daily_voice_time($1, $2, $3, $4)",
			[guildId, userId, username, durationSeconds]
		);

		// Remove from active sessions
		activeVoiceSessions.delete(sessionKey);

		logger.debug(`Tracked voice leave for ${username} (${durationSeconds}s)`);
	} catch (error) {
		logger.error("Error tracking voice leave:", error);
	}
}


/**
 * Get activity stats for a user
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} - User activity stats or null if not found
 */
async function getUserActivity(guildId, userId) {
	try {
		const result = await pool.query(
			"SELECT * FROM discord.get_user_activity($1, $2)",
			[guildId, userId]
		);

		if (result.rows.length === 0) {
			return null;
		}

		return result.rows[0];
	} catch (error) {
		logger.error("Error getting user activity:", error);
		return null;
	}
}

/**
 * Get top active users in a guild
 * @param {string} guildId - Guild ID
 * @param {number} limit - Number of users to return
 * @returns {Promise<Array>} - Array of top active users
 */
async function getTopActiveUsers(guildId, limit = 10) {
	try {
		const result = await pool.query(
			"SELECT * FROM discord.get_top_active_users($1, $2)",
			[guildId, limit]
		);

		return result.rows;
	} catch (error) {
		logger.error("Error getting top active users:", error);
		return [];
	}
}

/**
 * Get top users by longest streak in a guild
 * @param {string} guildId - Guild ID
 * @param {number} limit - Number of users to return
 * @returns {Promise<Array>} - Array of top streak users
 */
async function getTopStreakUsers(guildId, limit = 10) {
	try {
		const result = await pool.query(
			"SELECT * FROM discord.get_top_streak_users($1, $2)",
			[guildId, limit]
		);

		return result.rows;
	} catch (error) {
		logger.error("Error getting top streak users:", error);
		return [];
	}
}

/**
 * Format duration in seconds to human-readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} - Formatted duration
 */
function formatDuration(seconds) {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;

	const parts = [];
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
