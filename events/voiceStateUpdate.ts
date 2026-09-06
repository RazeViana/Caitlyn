/**
 * @file voiceStateUpdate.ts
 * @description Event handler for voice state updates (join, leave, move voice channels).
 * Tracks voice channel activity and duration for user activity statistics.
 *
 * @module voiceStateUpdate
 */

import { Events, type VoiceState } from "discord.js";
import { trackVoiceJoin, trackVoiceLeave } from "../core/activityTracker.js";
import logger from "../core/logger.js";

export const name = Events.VoiceStateUpdate;

interface VoiceStateLogger {
	debug: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
}

export interface VoiceStateDependencies {
	logger: VoiceStateLogger;
	trackVoiceJoin: (
		guildId: string,
		userId: string,
		username: string,
		channelId: string,
		channelName: string,
	) => Promise<void>;
	trackVoiceLeave: (
		guildId: string,
		userId: string,
		username: string,
		channelId?: string,
	) => Promise<void>;
}

const defaultVoiceStateDependencies: VoiceStateDependencies = {
	logger,
	trackVoiceJoin,
	trackVoiceLeave: (guildId, userId, username, channelId) => trackVoiceLeave(guildId, userId, username, undefined, channelId),
};

export async function execute(
	oldState: VoiceState,
	newState: VoiceState,
	dependencies: VoiceStateDependencies = defaultVoiceStateDependencies,
): Promise<void> {
	try {
		const { guild } = newState;
		const member = newState.member;
		if (!member) return;

		// Ignore bot users
		if (member.user.bot) return;

		const oldChannel = oldState.channel;
		const newChannel = newState.channel;

		// User joined a voice channel
		if (!oldChannel && newChannel) {
			dependencies.logger.debug(`${member.user.username} joined voice channel ${newChannel.name}`);
			await dependencies.trackVoiceJoin(
				guild.id,
				member.id,
				member.user.username,
				newChannel.id,
				newChannel.name,
			);
		}
		// User left a voice channel
		else if (oldChannel && !newChannel) {
			dependencies.logger.debug(`${member.user.username} left voice channel ${oldChannel.name}`);
			await dependencies.trackVoiceLeave(guild.id, member.id, member.user.username, oldChannel.id);
		}
		// User moved between voice channels
		else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
			dependencies.logger.debug(`${member.user.username} moved from ${oldChannel.name} to ${newChannel.name}`);
			// Track as leave from old channel
			await dependencies.trackVoiceLeave(guild.id, member.id, member.user.username, oldChannel.id);
			// Track as join to new channel
			await dependencies.trackVoiceJoin(
				guild.id,
				member.id,
				member.user.username,
				newChannel.id,
				newChannel.name,
			);
		}
	}
	catch (error) {
		dependencies.logger.error("Error in voiceStateUpdate event:", error);
	}
}
