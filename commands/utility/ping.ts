/**
 * @file ping.js
 * @description This module defines a simple "ping" command for a Discord bot using the Discord.js library.
 * The command responds with "Pong" when invoked, serving as a basic utility to check the bot's responsiveness.
 *
 * The command is implemented as a Slash Command with a cooldown period to prevent spamming.
 *
 * @module ping
 */

import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../../types/command.js";

const command: BotCommand = {
	cooldown: 5,
	category: "utility",
	data: new SlashCommandBuilder()
		.setName("ping")
		.setDescription("Replies with Pong!"),
	async execute(interaction) {
		await interaction.reply("Pong");
	},
};

export = command;
