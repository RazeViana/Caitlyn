/**
 * @file logs.ts
 * @description Lets the operator select Discord log types from inside the private logging channel.
 * Persists exact level selections without changing console LOG_LEVEL or exposing settings elsewhere.
 *
 * @module logs
 */

import { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { guildSettings } from "../../core/guildSettings.js";
import { logForwarders } from "../../core/discordLogForwarder.js";
import { isBotOperator } from "../../core/operatorAccess.js";
import { describeLogTypes, parseLogTypes } from "../../core/logLevels.js";
import { deferInteraction, respondWithError } from "../../core/interactionResponse.js";
import logger from "../../core/logger.js";
import { logData } from "../../core/dataLog.js";

export const category = "utility";
export const requiresDatabase = true;
export const operatorOnly = true;
export const cooldown = 3;
export const data = new SlashCommandBuilder()
	.setName("logs")
	.setDescription("Control private log output from the logging channel (bot owner only)")
	.setContexts(InteractionContextType.Guild)
	.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
	.addSubcommand((command) => command.setName("levels").setDescription("Choose exactly which log types appear")
		.addStringOption((option) => option.setName("types").setDescription("Comma-separated: debug,info,success,warning,error; or all / none")
			.setRequired(true).setMaxLength(100)))
	.addSubcommand((command) => command.setName("status").setDescription("Show the active log types"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
		await respondWithError(interaction, "Private log controls require the bot owner and server administrator permission.");
		return;
	}
	try {
		if (!await deferInteraction(interaction, { flags: MessageFlags.Ephemeral })) return;
		if (!await isBotOperator(interaction.client, interaction.user.id)) {
			await interaction.editReply("Only the bot application owner (or owning team's owner) can manage private logging.");
			return;
		}
		const current = await guildSettings.getMain();
		if (!current?.log_channel_id || current.guild_id !== interaction.guildId || current.log_channel_id !== interaction.channelId) {
			await interaction.editReply("Run this command inside the configured main-server logging channel.");
			return;
		}
		if (interaction.options.getSubcommand() === "status") {
			await interaction.editReply(`Showing: ${describeLogTypes(current.log_levels)}. Console LOG_LEVEL is unchanged.`);
			return;
		}
		let levels;
		try {
			levels = parseLogTypes(interaction.options.getString("types", true));
		}
		catch {
			await interaction.editReply("Use comma-separated debug, info, success, warning, error; or all or none. Example: /logs levels types:info,warning,error");
			return;
		}
		const saved = await guildSettings.setLevels(interaction.guildId, interaction.channelId, levels, true);
		logForwarders.get(interaction.client)?.update(saved);
		logData("Saved the selected Discord log types", { server: interaction.guildId, channel: interaction.channelId,
			actor: interaction.user.id, levels: describeLogTypes(saved.log_levels) }, logger.info);
		await interaction.editReply(`Showing: ${describeLogTypes(saved.log_levels)}. Saved for future restarts; console LOG_LEVEL is unchanged.`);
	}
	catch (error) {
		logger.error("Could not update private log levels:", error);
		await respondWithError(interaction, "Could not update log levels. Check database migrations 011/012 and try /logs status in the configured logging channel.");
	}
}
