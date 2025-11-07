/**
 * @file leaderboard.js
 * @description Command to view the server activity leaderboard.
 * Shows the most active users based on messages, voice time, and overall activity.
 *
 * @module leaderboard
 */

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { getTopActiveUsers, formatDuration } from "../../core/activityTracker.js";
import logger from "../../core/logger.js";

export const cooldown = 10;
export const category = "utility";
export const data = new SlashCommandBuilder()
	.setName("leaderboard")
	.setDescription("View the server activity leaderboard")
	.addIntegerOption((option) =>
		option
			.setName("limit")
			.setDescription("Number of users to show (default: 10)")
			.setMinValue(5)
			.setMaxValue(25)
			.setRequired(false)
	);

export async function execute(interaction) {
	try {
		const limit = interaction.options.getInteger("limit") || 10;
		const guildId = interaction.guild.id;

		await interaction.deferReply();

		// Fetch leaderboard data
		const topUsers = await getTopActiveUsers(guildId, limit);

		if (topUsers.length === 0) {
			await interaction.editReply({
				content: "No activity data available yet. Start chatting to build the leaderboard!",
			});
			return;
		}

		// Build leaderboard text
		const leaderboardText = topUsers
			.map((user, index) => {
				const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `**${index + 1}.**`;
				const voiceTime = formatDuration(parseInt(user.total_voice_time));

				return (
					`${medal} **${user.username}**\n` +
					`    💬 ${user.message_count} messages | ` +
					`🎤 ${user.voice_join_count} joins | ` +
					`⏱️ ${voiceTime}\n` +
					`    📊 Score: ${user.activity_score}`
				);
			})
			.join("\n\n");

		// Create embed
		const embed = new EmbedBuilder()
			.setColor(0xffd700)
			.setTitle(`🏆 ${interaction.guild.name} Activity Leaderboard`)
			.setDescription(leaderboardText)
			.setFooter({
				text: `Activity Score = Messages + Voice Joins + (Voice Time / 60)`,
			})
			.setTimestamp();

		await interaction.editReply({ embeds: [embed] });

		logger.debug(`Leaderboard viewed in guild ${guildId}`);
	} catch (error) {
		logger.error("Error fetching leaderboard:", error);
		await interaction.editReply({
			content: "❌ Failed to fetch leaderboard. Please try again later.",
		});
	}
}
