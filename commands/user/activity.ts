/**
 * @file activity.ts
 * @description Command to view user activity statistics.
 * Shows message count, voice joins, time in voice, and activity streaks.
 *
 * @module activity
 */

import {
	EmbedBuilder,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
} from "discord.js";
import { formatDuration, getUserActivity } from "../../core/activityTracker.js";
import logger from "../../core/logger.js";
import type { ActivityRow } from "../../types/models.js";

export interface ActivityCommandDependencies {
	getUserActivity: (guildId: string, userId: string) => Promise<ActivityRow | null>;
}

const defaultActivityCommandDependencies: ActivityCommandDependencies = {
	getUserActivity,
};

export const cooldown = 5;
export const category = "user";
export const data = new SlashCommandBuilder()
	.setName("activity")
	.setDescription("View user activity statistics")
	.addUserOption((option) =>
		option
			.setName("user")
			.setDescription("The user to view activity for (defaults to yourself)")
			.setRequired(false),
	);

export async function execute(
	interaction: ChatInputCommandInteraction,
	dependencies: ActivityCommandDependencies = defaultActivityCommandDependencies,
): Promise<void> {
	try {
		const targetUser = interaction.options.getUser("user") || interaction.user;
		const guildId = interaction.guild!.id;

		// Fetch activity data
		const activity = await dependencies.getUserActivity(guildId, targetUser.id);

		if (!activity) {
			await interaction.reply({
				content: `No activity data found for ${targetUser.username}.`,
				ephemeral: true,
			});
			return;
		}

		// Calculate relative time for first/last seen
		const firstSeenTimestamp = Math.floor(new Date(activity.first_seen_at!).getTime() / 1000);
		const lastSeenTimestamp = Math.floor(new Date(activity.last_seen_at!).getTime() / 1000);

		// Calculate days active and averages
		const firstSeenDate = new Date(activity.first_seen_at!);
		const lastSeenDate = new Date(activity.last_seen_at!);
		const daysActive = Math.max(
			1,
			Math.ceil((lastSeenDate.getTime() - firstSeenDate.getTime()) / (1000 * 60 * 60 * 24)) + 1,
		);
		const avgMessagesPerDay = (Number.parseInt(String(activity.message_count)) / daysActive).toFixed(1);
		const avgVoiceTimePerDay = Math.floor(Number.parseInt(String(activity.total_voice_time)) / daysActive);

		// Create embed
		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle(`📊 Activity Stats for ${activity.username}`)
			.setThumbnail(targetUser.displayAvatarURL())
			.addFields(
				{
					name: "💬 Messages Sent",
					value: activity.message_count!.toString(),
					inline: true,
				},
				{
					name: "🎤 Voice Joins",
					value: activity.voice_join_count!.toString(),
					inline: true,
				},
				{
					name: "⏱️ Time in Voice",
					value: formatDuration(Number.parseInt(String(activity.total_voice_time))),
					inline: true,
				},
				{
					name: "📊 Avg Messages/Day",
					value: avgMessagesPerDay,
					inline: true,
				},
				{
					name: "📊 Avg Voice Time/Day",
					value: formatDuration(avgVoiceTimePerDay),
					inline: true,
				},
				{
					name: "📆 Days Active",
					value: daysActive.toString(),
					inline: true,
				},
				{
					name: "📅 First Seen",
					value: `<t:${firstSeenTimestamp}:R>`,
					inline: true,
				},
				{
					name: "👁️ Last Seen",
					value: `<t:${lastSeenTimestamp}:R>`,
					inline: true,
				},
				{
					name: "\u200b",
					value: "\u200b",
					inline: true,
				},
				{
					name: "🔥 Daily Streak",
					value: `**${activity.daily_streak_current || 0}** days (Best: ${activity.daily_streak_longest || 0})`,
					inline: true,
				},
				{
					name: "📅 Weekly Streak",
					value: `**${activity.weekly_streak_current || 0}** weeks (Best: ${activity.weekly_streak_longest || 0})`,
					inline: true,
				},
				{
					name: "📆 Monthly Streak",
					value: `**${activity.monthly_streak_current || 0}** months (Best: ${activity.monthly_streak_longest || 0})`,
					inline: true,
				},
			)
			.setTimestamp()
			.setFooter({
				text: `Requested by ${interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL(),
			});

		await interaction.reply({ embeds: [embed] });

		logger.debug(`Activity stats viewed for ${targetUser.username}`);
	}
	catch (error) {
		logger.error("Error fetching activity stats:", error);
		await interaction.reply({
			content: "❌ Failed to fetch activity stats. Please try again later.",
			ephemeral: true,
		});
	}
}
