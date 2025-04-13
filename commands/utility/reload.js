const { SlashCommandBuilder, MessageFlags } = require("discord.js");

module.exports = {
	category: "utility",
	data: new SlashCommandBuilder()
		.setName("reload")
		.setDescription("Reloads a command.")
		.addStringOption((option) =>
			option
				.setName("command")
				.setDescription("The command to reload.")
				.setRequired(true)
				.setAutocomplete(true)
		),
	async execute(interaction) {
		// Get the command name to be reloaded
		const commandName = interaction.options
			.getString("command", true)
			.tolowerCase();
		// Get the command from the client using the command name
		const command = interaction.client.commands.get(commandName);

		// Check if the command exists
		if (!command) {
			return interaction.reply({
				content: `There is no command with name \`/${commandName}\``,
				flags: MessageFlags.Ephemeral,
			});
		}

		// Delete the command from the require cache
		try {
			delete require.cache[
				require.resolve(`../${command.category}/${command.data.name}.js`)
			];
		} catch (error) {
			console.error(error);
			await interaction.reply({
				content: "Command missing category, sort it out mate",
				flags: MessageFlags.Ephemeral,
			});
		}

		try {
			// Delete the command from the client commands collection
			interaction.client.commands.delete(command.data.name);
			// Require the command again and add it back to the client commands collection
			const newCommand = require(`../${command.category}/${command.data.name}.js`);
			// Set the commands to the client commands collection
			interaction.client.commands.set(newCommand.data.name, newCommand);
			await interaction.reply(
				`Command \`/${newCommand.data.name}\` was reloaded!`
			);
		} catch (error) {
			console.error(error);
			await interaction.reply({
				content: `There was an error while reloading a command \`/${command.data.name}\`:\n\`${error.message}\``,
				flags: MessageFlags.Ephemeral,
			});
		}
	},

	autocomplete: async (interaction) => {
		const focused = interaction.options.getFocused();
		const choices = [...interaction.client.commands.keys()];

		const filtered = choices.filter((cmd) => cmd.startsWith(focused));
		await interaction.respond(
			filtered
				.map((cmd) => ({
					name: cmd,
					value: cmd,
				}))
				.slice(0, 25) // Discord only allows 25 choices max
		);
	},
};
