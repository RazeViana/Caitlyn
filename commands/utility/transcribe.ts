/**
 * @file transcribe.ts
 * @description Formats private administrator controls and status cards for local voice transcription without exposing transcripts.
 * @module transcribe
 */

import { ChannelType, EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
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
		await respondWithError(interaction, "**Administrator access required**\nOnly server administrators can control voice transcription.");
		return;
	}
	if (!await deferInteraction(interaction, { flags: MessageFlags.Ephemeral })) return;
	const runtime = transcriptionRuntimes.get(interaction.client);
	if (!runtime || runtime.config.guildId !== interaction.guildId) {
		await interaction.editReply("**Voice transcription unavailable**\nLocal recording is disabled in this server. Ask the bot operator to enable it.");
		return;
	}
	try {
		const action = interaction.options.getSubcommand();
		if (action === "stop") {await runtime.pause();}
		else if (action === "resume") {await runtime.resume();}
		else if (action === "start") {
			const member = await interaction.guild.members.fetch(interaction.user.id);
			if (member.voice.channel?.type !== ChannelType.GuildVoice) {
				await interaction.editReply("**No voice channel selected**\nJoin an ordinary voice channel first, then run `/transcribe start`.");
				return;
			}
			await runtime.resume(member.voice.channel.id);
		}
		const title = action === "stop" ? "⏸️ Transcription paused"
			: action === "start" || action === "resume" ? "🎙️ Automatic transcription enabled"
				: "🎙️ Voice transcription";
		const embed = new EmbedBuilder()
			.setColor(0x5865f2)
			.setTitle(title)
			.setDescription(runtime.status())
			.setFooter({ text: "One voice channel at a time · Raw audio is not saved" })
			.setTimestamp();
		await interaction.editReply({ content: "", embeds: [embed], allowedMentions: { parse: [] } });
	}
	catch {
		await respondWithError(interaction, "**Could not update voice transcription**\nTo change channels, use `/transcribe stop`, join the new channel, then use `/transcribe start`.\nIf the problem continues, ask the bot operator to check local log storage and the speech service.");
	}
}
