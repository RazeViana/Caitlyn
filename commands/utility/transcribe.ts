/**
 * @file transcribe.ts
 * @description Lets administrators pause, resume and inspect local voice transcription without exposing transcripts.
 * @module transcribe
 */

import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { deferInteraction, respondWithError } from "../../core/interactionResponse.js";
import { transcriptionRuntimes } from "../../core/transcriptionRuntime.js";

export const category = "utility";
export const cooldown = 3;
export const data = new SlashCommandBuilder().setName("transcribe").setDescription("Control local voice transcripts and daily logs")
	.setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
	.addSubcommand((command) => command.setName("status").setDescription("Show the recording state without revealing conversations"))
	.addSubcommand((command) => command.setName("start").setDescription("Record your current voice channel and enable automatic recording"))
	.addSubcommand((command) => command.setName("stop").setDescription("Stop recording and pause automatic recording, including after a restart"))
	.addSubcommand((command) => command.setName("resume").setDescription("Resume automatic recording of occupied voice channels"));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
	if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
		await respondWithError(interaction, "Only server administrators can control voice transcription.");
		return;
	}
	if (!await deferInteraction(interaction, { flags: MessageFlags.Ephemeral })) return;
	const runtime = transcriptionRuntimes.get(interaction.client);
	if (!runtime || runtime.config.guildId !== interaction.guildId) {
		await interaction.editReply("Local voice transcription is disabled in this server. Configure the local speech worker and TRANSCRIPTION_* settings first.");
		return;
	}
	try {
		const action = interaction.options.getSubcommand();
		if (action === "stop") {await runtime.pause();}
		else if (action === "resume") {await runtime.resume();}
		else if (action === "start") {
			const member = await interaction.guild.members.fetch(interaction.user.id);
			if (member.voice.channel?.type !== ChannelType.GuildVoice) {
				await interaction.editReply("Join an ordinary voice channel first.");
				return;
			}
			await runtime.resume(member.voice.channel.id);
		}
		await interaction.editReply({ content: runtime.status(), allowedMentions: { parse: [] } });
	}
	catch {
		await respondWithError(interaction, "Could not change voice transcription. Check local log storage and the speech worker. To change channels, stop the current recording first, then use /transcribe start.");
	}
}
