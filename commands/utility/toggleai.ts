/**
 * @file toggleai.ts
 * @description Command to toggle Caitlyn AI on/off at runtime.
 * Only administrators can use this command.
 *
 * @module toggleai
 */

import {
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
} from "discord.js";
import { isAIEnabled, toggleAI } from "../../core/aiState.js";
import logger from "../../core/logger.js";
import { logData } from "../../core/dataLog.js";
import { respondWithError } from "../../core/interactionResponse.js";
import { getFeatureConfiguration } from "../../core/environment.js";

export const cooldown = 5;
export const category = "utility";
export const data = new SlashCommandBuilder()
	.setName("toggleai")
	.setDescription("Toggle Caitlyn AI on/off")
	.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	try {
		const configuration = getFeatureConfiguration().ai;
		if (!configuration.configured) {
			logger.warn("AI toggle refused; configuration unavailable", configuration.problems.join("; "));
			await respondWithError(interaction, "AI is disabled because its configuration is missing or invalid. Ask the operator to check the startup logs and restart after updating it.");
			return;
		}
		const newState = toggleAI();

		const statusEmoji = newState ? "✅" : "❌";
		const statusText = newState ? "enabled" : "disabled";

		logData("Changed AI reply setting for this running bot", { server: interaction.guildId,
			actor: interaction.user.id, username: interaction.user.username, enabled: newState }, logger.info);

		await interaction.reply({
			content: `${statusEmoji} Caitlyn AI is now **${statusText}**`,
			flags: MessageFlags.Ephemeral,
		});
	}
	catch (error) {
		logger.error("Error toggling AI:", error);
		await respondWithError(interaction, `Could not confirm the change. AI is currently ${isAIEnabled() ? "enabled" : "disabled"}.`);
	}
}
