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
	.addSubcommand((command) => command.setName("resume").setDescription("Resume automatic recording of occupied voice channels"))
	.addSubcommand((command) => command.setName("exclude").setDescription("Exclude a voice channel from automatic recording")
		.addChannelOption((option) => option.setName("channel").setDescription("Voice channel to exclude").addChannelTypes(ChannelType.GuildVoice).setRequired(true)))
	.addSubcommand((command) => command.setName("include").setDescription("Remove a voice channel exclusion")
		.addChannelOption((option) => option.setName("channel").setDescription("Voice channel to include").addChannelTypes(ChannelType.GuildVoice).setRequired(true)))
	.addSubcommand((command) => command.setName("correct").setDescription("Correct a speech entry from a conversation you attended; preserve the original")
		.addStringOption((option) => option.setName("event").setDescription("Transcript event ID").setMaxLength(128).setRequired(true))
		.addStringOption((option) => option.setName("text").setDescription("Corrected transcription").setMaxLength(2000).setRequired(true)))
	.addSubcommand((command) => command.setName("retention").setDescription("Set transcript retention; 0 keeps records indefinitely")
		.addIntegerOption((option) => option.setName("days").setDescription("Days to keep; 0 disables automatic deletion").setMinValue(0).setMaxValue(36500).setRequired(true))
		.addBooleanOption((option) => option.setName("confirm-deletion").setDescription("Required for a positive period: permanently delete older daily logs and database entries")));

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
		if (action === "stop") {await runtime.pause(interaction.user.id);}
		else if (action === "resume") {await runtime.resume(undefined, interaction.user.id);}
		else if (action === "include" || action === "exclude") {
			await runtime.exclude(interaction.options.getChannel("channel", true).id, action === "exclude", interaction.user.id);
		}
		else if (action === "correct") {
			await runtime.correct(interaction.options.getString("event", true), interaction.user.id, interaction.user.username, interaction.options.getString("text", true));
			await interaction.editReply({ content: "**Correction saved**\nThe original entry is preserved. The correction has the same participant access as the original.", allowedMentions: { parse: [] } });
			return;
		}
		else if (action === "retention") {
			const days = interaction.options.getInteger("days", true);
			if (days && interaction.options.getBoolean("confirm-deletion") !== true) {
				await interaction.editReply("**Deletion confirmation required**\nA positive retention period permanently removes older daily logs, quarantine records and database entries. Existing backups have their own retention. Repeat with `confirm-deletion: true` to apply it.");
				return;
			}
			await runtime.setRetention(days, interaction.user.id);
		}
		else if (action === "start") {
			const member = await interaction.guild.members.fetch(interaction.user.id);
			if (member.voice.channel?.type !== ChannelType.GuildVoice) {
				await interaction.editReply("**No voice channel selected**\nJoin an ordinary voice channel first, then run `/transcribe start`.");
				return;
			}
			await runtime.resume(member.voice.channel.id, interaction.user.id);
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
		await respondWithError(interaction, "**Could not update voice transcription**\nCheck the selected channel and exclusions. Corrections require a database entry from a conversation you attended.\nTo change channels, use `/transcribe stop`, join the new channel, then use `/transcribe start`. If the problem continues, check recording health.");
	}
}
