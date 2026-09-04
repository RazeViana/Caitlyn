/**
 * @file user.ts
 * @description This module defines a Discord slash command that provides information about the user who invoked it.
 * The command displays the username of the user and the date they joined the server.
 *
 * The command is implemented as a Slash Command with a cooldown period to prevent spamming.
 *
 * @module user_command
 */

import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../../types/command.js";
import type { GuildMember } from "discord.js";

const command: BotCommand = {
	cooldown: 5,
	category: "utility",
	data: new SlashCommandBuilder()
		.setName("user")
		.setDescription("Provides information about the user."),
	async execute(interaction) {
		// interaction.user is the object representing the User who ran the command
		// interaction.member is the GuildMember object, which represents the user in the specific guild
		await interaction.reply(
			`This command was run by ${interaction.user.username}, who joined on ${(interaction.member as GuildMember).joinedAt}.`
		);
	},
};

export = command;
