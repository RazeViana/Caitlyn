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
import { getFeatureConfiguration } from "../core/environment.js";
import { logData } from "../core/dataLog.js";

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
	trackVoiceJoin: async (...args) => {
		if (getFeatureConfiguration().database.enabled) await trackVoiceJoin(...args);
		else logData("Voice join not saved; database feature is turned off", { server: args[0], user: args[1], channel: args[3] });
	},
	trackVoiceLeave: async (guildId, userId, username, channelId) => {
		if (getFeatureConfiguration().database.enabled) await trackVoiceLeave(guildId, userId, username, undefined, channelId);
		else logData("Voice leave not saved; database feature is turned off", { server: guildId, user: userId, channel: channelId });
	},
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
			logData("User joined a voice channel", { server: guild.id, user: member.id, username: member.user.username,
				channel: newChannel.id, channelName: newChannel.name }, dependencies.logger.debug);
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
			logData("User left a voice channel", { server: guild.id, user: member.id, username: member.user.username,
				channel: oldChannel.id, channelName: oldChannel.name }, dependencies.logger.debug);
			await dependencies.trackVoiceLeave(guild.id, member.id, member.user.username, oldChannel.id);
		}
		// User moved between voice channels
		else if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
			logData("User moved between voice channels", { server: guild.id, user: member.id, username: member.user.username,
				previousChannel: oldChannel.id, channel: newChannel.id, channelName: newChannel.name }, dependencies.logger.debug);
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
