import path from "node:path";
import { createRequire } from "node:module";
import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../../types/command.js";

const loadModule = createRequire(__filename);

const command: BotCommand = {
	category: "utility",
	data: new SlashCommandBuilder()
		.setName("reload")
		.setDescription("Reloads a command.")
		.addStringOption((option) =>
			option
				.setName("command")
				.setDescription("The command to reload.")
				.setRequired(true)
				.setAutocomplete(true),
		),
	async execute(interaction) {
		// Get the command name to be reloaded
		const commandName = interaction.options
			.getString("command", true)
			.toLowerCase();
		// Get the command from the client using the command name
		const loadedCommand = interaction.client.commands.get(commandName);

		// Check if the command exists
		if (!loadedCommand) {
			return interaction.reply({
				content: `There is no command with name \`/${commandName}\``,
				flags: MessageFlags.Ephemeral,
			});
		}

		const moduleExtension = path.extname(__filename);
		const commandPath = `../${command.category}/${command.data.name}${moduleExtension}`;

		// Delete the command from the require cache
		try {
			delete loadModule.cache[loadModule.resolve(commandPath)];
		}
		catch (error) {
			console.error(error);
			await interaction.reply({
				content: "Command missing category, sort it out mate",
				flags: MessageFlags.Ephemeral,
			});
		}

		try {
			// Delete the command from the client commands collection
			interaction.client.commands.delete(loadedCommand.data.name);
			// Require the command again and add it back to the client commands collection
			const newCommand = loadModule(commandPath);
			// Set the commands to the client commands collection
			interaction.client.commands.set(newCommand.data.name, newCommand);
			await interaction.reply(
				`Command \`/${newCommand.data.name}\` was reloaded!`,
			);
		}
		catch (error) {
			console.error(error);
			await interaction.reply({
				content: `There was an error while reloading a command \`/${loadedCommand.data.name}\`:\n\`${(error as Error).message}\``,
				flags: MessageFlags.Ephemeral,
			});
		}
	},

	autocomplete: async (interaction) => {
		const focused = interaction.options.getFocused();
		const choices = [...interaction.client.commands.keys()];

		const filtered = choices.filter((cmd) => cmd.startsWith(focused));
		// Discord only allows 25 choices max
		await interaction.respond(
			filtered
				.map((cmd) => ({
					name: cmd,
					value: cmd,
				}))
				.slice(0, 25),
		);
	},
};

export = command;
