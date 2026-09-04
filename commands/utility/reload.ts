import {
	SlashCommandBuilder,
	MessageFlags,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
} from "discord.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import logger from "../../core/logger.js";
import { isBotCommand } from "../../types/command.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ReloadDependencies {
	importModule: (specifier: string) => Promise<unknown>;
	now: () => number;
}

const defaultReloadDependencies: ReloadDependencies = {
	importModule: (specifier) => import(specifier),
	now: Date.now,
};

export const category = "utility";
export const data = new SlashCommandBuilder()
	.setName("reload")
	.setDescription("Reloads a command.")
	.addStringOption((option) =>
		option
			.setName("command")
			.setDescription("The command to reload.")
			.setRequired(true)
			.setAutocomplete(true),
	);
export async function execute(
	interaction: ChatInputCommandInteraction,
	dependencies: ReloadDependencies = defaultReloadDependencies,
): Promise<void> {
	// Get the command name to be reloaded
	const commandName = interaction.options
		.getString("command", true)
		.toLowerCase();
	// Get the command from the client using the command name
	const loadedCommand = interaction.client.commands.get(commandName);

	// Check if the command exists
	if (!loadedCommand) {
		await interaction.reply({
			content: `There is no command with name \`/${commandName}\``,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	if (!loadedCommand.category) {
		await interaction.reply({
			content: "Command missing category, sort it out mate",
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	try {
		// Import the command again with a timestamp to force reload
		const moduleExtension = path.extname(__filename);
		const commandPath = path.join(
			__dirname,
			"..",
			loadedCommand.category,
			`${loadedCommand.data.name}${moduleExtension}`,
		);
		const fileUrl = pathToFileURL(commandPath);
		fileUrl.searchParams.set("update", dependencies.now().toString());
		let newCommand: unknown;
		try {
			newCommand = await dependencies.importModule(fileUrl.href);
		}
		catch (error) {
			// Preserve the current behavior of removing a command when its import fails.
			interaction.client.commands.delete(loadedCommand.data.name);
			throw error;
		}
		if (!isBotCommand(newCommand)) {
			throw new Error("Reloaded command is invalid.");
		}
		// Set the commands to the client commands collection
		interaction.client.commands.delete(loadedCommand.data.name);
		interaction.client.commands.set(newCommand.data.name, newCommand);
		await interaction.reply(
			`Command \`/${newCommand.data.name}\` was reloaded!`,
		);
	}
	catch (error) {
		logger.error("Error reloading command:", error);
		const errorMessage = (error as { message?: unknown }).message;
		await interaction.reply({
			content: `There was an error while reloading a command \`/${loadedCommand.data.name}\`:\n\`${errorMessage}\``,
			flags: MessageFlags.Ephemeral,
		});
	}
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
	const focused = interaction.options.getFocused() as string;
	const choices = [...interaction.client.commands.keys()];

	const filtered = choices.filter((cmd) => cmd.startsWith(focused));
	await interaction.respond(
		filtered
			.map((cmd) => ({
				name: cmd,
				value: cmd,
			}))
			// Discord only allows 25 choices max
			.slice(0, 25),
	);
}
