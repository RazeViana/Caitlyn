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
	type InteractionReplyOptions,
} from "discord.js";
import { isAIEnabled, toggleAI } from "../../core/aiState.js";
import logger from "../../core/logger.js";

export const cooldown = 5;
export const category = "utility";
export const data = new SlashCommandBuilder()
	.setName("toggleai")
	.setDescription("Toggle Caitlyn AI on/off")
	.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	try {
		const previousState = isAIEnabled();
		const newState = toggleAI();

		const statusEmoji = newState ? "✅" : "❌";
		const statusText = newState ? "enabled" : "disabled";

		logger.info(
			`AI toggled ${previousState ? "OFF" : "ON"} by ${interaction.user.username}`,
		);

		await interaction.reply({
			content: `${statusEmoji} Caitlyn AI is now **${statusText}**`,
			flags: MessageFlags.Ephemeral,
		});
	}
	catch (error) {
		logger.error("Error toggling AI:", error);
		const failureResponse = {
			content: "❌ Failed to toggle AI. Check the logs for details.",
			MessageFlags: MessageFlags.Ephemeral,
		} as unknown as InteractionReplyOptions;
		await interaction.reply(failureResponse);
	}
}
