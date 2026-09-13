/**
 * @file social.ts
 * @description Lets server administrators opt text channels into X and TikTok previews or disable them.
 * Settings are separate from private operator logging and default to disabled.
 *
 * @module social
 */

import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { socialDeliveryStore } from "../../core/socialDeliveryStore.js";
import { socialRuntimes } from "../../core/socialRuntime.js";
import { deferInteraction, respondWithError } from "../../core/interactionResponse.js";
import logger from "../../core/logger.js";

export const category = "utility";
export const requiresDatabase = true;
export const cooldown = 5;
export const data = new SlashCommandBuilder().setName("social").setDescription("Configure X and TikTok previews in this server")
	.setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
	.addSubcommand((command) => command.setName("enable").setDescription("Enable X and TikTok previews in this text channel"))
	.addSubcommand((command) => command.setName("disable").setDescription("Disable new previews in this text channel"))
	.addSubcommand((command) => command.setName("disable-server").setDescription("Disable new previews throughout this server"))
	.addSubcommand((command) => command.setName("status").setDescription("Show this server's preview settings"));

export async function execute(interaction: ChatInputCommandInteraction, store = socialDeliveryStore): Promise<void> {
	if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
		await respondWithError(interaction, "Only server administrators can configure social previews.");
		return;
	}
	try {
		if (!await deferInteraction(interaction, { flags: MessageFlags.Ephemeral })) return;
		const action = interaction.options.getSubcommand();
		if (action === "status") {
			const channels = (await store.settings(interaction.guildId)).filter((setting) => setting.enabled);
			const list = channels.slice(0, 25).map((setting) => `<#${setting.channel_id}>`).join(", ") || "None";
			await interaction.editReply({ content: `X and TikTok preview channels: ${list}${channels.length > 25 ? " (first 25 shown)" : ""}.\nWorker integration: ${socialRuntimes.has(interaction.client) ? "enabled" : "disabled by the operator"}. Complete replacements mention the sender and remove the original when safe. TikTok videos and mobile share links are supported; slideshows and login-restricted posts keep their originals.`, allowedMentions: { parse: [] } });
			return;
		}
		if (!["enable", "disable", "disable-server"].includes(action)) throw new Error("invalid_action");
		if (action !== "disable-server" && interaction.channel?.type !== ChannelType.GuildText) {
			await interaction.editReply("Run this command in a server text channel. Threads and announcement channels are not supported yet.");
			return;
		}
		if (action === "enable" && !socialRuntimes.has(interaction.client)) {
			await interaction.editReply("The operator must enable the isolated social worker before channels can opt in.");
			return;
		}
		await store.configure(interaction.guildId, action === "disable-server" ? null : interaction.channelId!, action === "enable");
		logger.info("Social preview configuration updated", action, interaction.channelId);
		await interaction.editReply(action === "enable" ? "X and TikTok previews enabled here. Complete replacements mention the sender and remove the original (requires Manage Messages). Failed/partial previews, TikTok slideshows, or extra source attachments keep the original."
			: "New previews disabled and pending jobs cancelled. Existing completed previews are left in place.");
	}
	catch {
		logger.warn("Could not update social settings; no provider content logged");
		await respondWithError(interaction, "Could not update social settings. Check database access and migration 014 / 016, then use /social status to confirm the saved state.");
	}
}
