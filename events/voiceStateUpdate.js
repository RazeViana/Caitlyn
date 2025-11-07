/**
 * @file voiceStateUpdate.js
 * @description Event handler for voice state updates (join, leave, move voice channels).
 * Tracks voice channel activity and duration for user activity statistics.
 *
 * @module voiceStateUpdate
 */

import { Events } from "discord.js";
import { trackVoiceJoin, trackVoiceLeave } from "../core/activityTracker.js";
import logger from "../core/logger.js";

export const name = Events.VoiceStateUpdate;

export async function execute(oldState, newState) {
	try {
		const { member, guild } = newState;

		// Ignore bot users
		if (member.user.bot) return;

		const oldChannel = oldState.channel;
		const newChannel = newState.channel;

		// User joined a voice channel
		if (!oldChannel && newChannel) {
			logger.debug(`${member.user.username} joined voice channel ${newChannel.name}`);
			await trackVoiceJoin(
				guild.id,
				member.id,
				member.user.username,
				newChannel.id,
				newChannel.name
			);
		}
		// User left a voice channel
		else if (oldChannel && !newChannel) {
			logger.debug(`${member.user.username} left voice channel ${oldChannel.name}`);
			await trackVoiceLeave(guild.id, member.id, member.user.username);
		}
		// User moved between voice channels
		else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
			logger.debug(`${member.user.username} moved from ${oldChannel.name} to ${newChannel.name}`);
			// Track as leave from old channel
			await trackVoiceLeave(guild.id, member.id, member.user.username);
			// Track as join to new channel
			await trackVoiceJoin(
				guild.id,
				member.id,
				member.user.username,
				newChannel.id,
				newChannel.name
			);
		}
	} catch (error) {
		logger.error("Error in voiceStateUpdate event:", error);
	}
}
