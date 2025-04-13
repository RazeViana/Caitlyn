/**
 * @file server.js
 * @description This module defines a Discord slash command that provides information about the server where the command is executed.
 * It uses the Discord.js library to create a command that displays the server's name and member count.
 *
 * The command is implemented as a Slash Command with a cooldown period to prevent spamming.
 *
 * @module server_command
 */

const { SlashCommandBuilder } = require("discord.js");

module.exports = {
	cooldown: 5,
	category: "utility",
	data: new SlashCommandBuilder()
		.setName("server")
		.setDescription("Provides information about the server."),
	async execute(interaction) {
		// interaction.guild is the object representing the Guild in which the command was run
		await interaction.reply(
			`This server is ${interaction.guild.name} and has ${interaction.guild.memberCount} members.`
		);
	},
};
