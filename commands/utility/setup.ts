/**
 * @file setup.ts
 * @description Lets the bot operator reserve a single main-server channel for private logging.
 * Rejects other administrators and servers without disclosing the configured destination.
 *
 * @module setup
 */

import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { guildSettings } from "../../core/guildSettings.js";
import { logChannel, logForwarders } from "../../core/discordLogForwarder.js";
import { respondWithError } from "../../core/interactionResponse.js";
import { withTimeout } from "../../core/asyncTools.js";
import logger from "../../core/logger.js";
import { isBotOperator } from "../../core/operatorAccess.js";
import { describeLogTypes } from "../../core/logLevels.js";

export const category = "utility";
export const operatorOnly = true;
export const cooldown = 5;
export const data = new SlashCommandBuilder()
	.setName("setup")
	.setDescription("Configure private main-server logging (bot owner only)")
	.setContexts(InteractionContextType.Guild)
	.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
	.addSubcommand((command) => command.setName("logs").setDescription("Choose the private main-server log channel")
		.addChannelOption((option) => option.setName("channel").setDescription("Choose a private text channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
	.addSubcommand((command) => command.setName("status").setDescription("Show the current log configuration"))
	.addSubcommand((command) => command.setName("disable").setDescription("Disable forwarding in this server"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
		await respondWithError(interaction, "Only server administrators can configure Caitlyn inside a server.");
		return;
	}
	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!await isBotOperator(interaction.client, interaction.user.id)) {
			await interaction.editReply("Only the bot application owner (or owning team's owner) can manage private logging.");
			return;
		}
		const action = interaction.options.getSubcommand();
		const existing = await guildSettings.getMain();
		if (existing && existing.guild_id !== interaction.guildId) {
			await interaction.editReply("Logging is restricted to the configured main server.");
			return;
		}
		if (action === "status") {
			await interaction.editReply(existing?.log_channel_id
				? `Logs: <#${existing.log_channel_id}>. Showing: ${describeLogTypes(existing.log_levels)}. Run /logs levels inside that channel to change the selection.`
				: "Logging is disabled or not yet configured. Use /setup logs in your main server and select a private text channel. Console logging is unchanged.");
			return;
		}
		let channelId: string | null = null;
		if (action === "logs") {
			channelId = interaction.options.getChannel("channel", true).id;
			const channel = await withTimeout(logChannel(interaction.client, interaction.guildId, channelId), 8000, "Log channel validation");
			if (channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) !== false) {
				await interaction.editReply("Full-console logs may contain activity from every server. Choose a private channel hidden from @everyone, and allow only trusted staff to view it.");
				return;
			}
		}
		if (action !== "logs" && action !== "disable") throw new Error("Unknown setup action");
		const settings = await guildSettings.save(interaction.guildId, channelId, true);
		logForwarders.get(interaction.client)?.update(settings);
		logger.info(action === "disable" ? "Private Discord logging disabled" : "Private main-server logging configured");
		await interaction.editReply(channelId
			? `Logs will be sent only to <#${channelId}> in this main server. Showing: ${describeLogTypes(settings.log_levels)}. Run /logs levels in that channel to choose what appears. Keep access limited to trusted staff.`
			: "Discord forwarding is disabled. This main server remains reserved; other servers cannot enable logging. Console logging continues.");
	}
	catch (error) {
		logger.error("Could not configure Discord logging:", error);
		await respondWithError(interaction, "Could not update log settings. Check the bot's View Channel/Send Messages permissions and database migrations 011/012. Logging can only be configured in the reserved main server. Use /setup status to check what is saved.");
	}
}
