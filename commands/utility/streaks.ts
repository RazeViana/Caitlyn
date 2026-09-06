/**
 * @file streaks.ts
 * @description Command to view the server activity streak leaderboard.
 * Shows users with the longest daily streaks.
 *
 * @module streaks
 */

import {
	EmbedBuilder,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
} from "discord.js";
import { getTopStreakUsers } from "../../core/activityTracker.js";
import logger from "../../core/logger.js";
import { respondWithError } from "../../core/interactionResponse.js";
import { truncate } from "../../core/textLimits.js";
import type { ActivityRow } from "../../types/models.js";

export interface StreaksCommandDependencies {
	getTopStreakUsers: (guildId: string, limit?: number) => Promise<ActivityRow[]>;
}

const defaultStreaksCommandDependencies: StreaksCommandDependencies = {
	getTopStreakUsers,
};

export const cooldown = 5;
export const category = "utility";
export const data = new SlashCommandBuilder()
	.setName("streaks")
	.setDescription("View the server activity streak leaderboard")
	.addIntegerOption((option) =>
		option
			.setName("limit")
			.setDescription("Number of users to show (default: 10)")
			.setMinValue(5)
			.setMaxValue(25)
			.setRequired(false),
	);

export async function execute(
	interaction: ChatInputCommandInteraction,
	dependencies: StreaksCommandDependencies = defaultStreaksCommandDependencies,
): Promise<void> {
	try {
		if (!interaction.guild) {
			await respondWithError(interaction, "Use this command in a server.");
			return;
		}
		await interaction.deferReply();
		const limit = interaction.options.getInteger("limit") || 10;
		const guildId = interaction.guild!.id;

		// Fetch top streak users
		const topUsers = await dependencies.getTopStreakUsers(guildId, limit);

		if (topUsers.length === 0) {
			await interaction.editReply({
				content: "No activity streak data found for this server yet.",
			});
			return;
		}

		// Build leaderboard text
		let leaderboardText = "";
		for (let i = 0; i < topUsers.length; i++) {
			const user = topUsers[i];
			const position = i + 1;
			const medal = position === 1 ? "🥇" : position === 2 ? "🥈" : position === 3 ? "🥉" : `${position}.`;

			leaderboardText += `${medal} **${user.username}**\n`;
			leaderboardText += `   🔥 Daily: **${user.daily_streak_current || 0}** (Best: ${user.daily_streak_longest || 0})\n`;
			leaderboardText += `   📅 Weekly: **${user.weekly_streak_current || 0}** | 📆 Monthly: **${user.monthly_streak_current || 0}**\n\n`;
		}

		// Create embed
		const embed = new EmbedBuilder()
			.setColor(0xff6b35)
			.setTitle("🔥 Activity Streak Leaderboard")
			.setDescription(truncate(leaderboardText, 4_000))
			.setTimestamp()
			.setFooter({
				text: `Requested by ${interaction.user.username}`,
				iconURL: interaction.user.displayAvatarURL(),
			});

		await interaction.editReply({ embeds: [embed] });

		logger.debug("Streak leaderboard viewed");
	}
	catch (error) {
		logger.error("Error fetching streak leaderboard:", error);
		await respondWithError(interaction, "❌ Failed to fetch streak leaderboard. Please try again later.");
	}
}
