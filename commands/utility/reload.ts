/**
 * @file reload.ts
 * @description Reloads a slash command through a cache-busted module import.
 * Validates the replacement before updating the registry and reports failures safely.
 *
 * @module reload
 */

import {
	SlashCommandBuilder,
	MessageFlags,
	PermissionFlagsBits,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
} from "discord.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import logger from "../../core/logger.js";
import { isBotCommand } from "../../types/command.js";
import { respondWithError } from "../../core/interactionResponse.js";

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
	.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
		const newCommand: unknown = await dependencies.importModule(fileUrl.href);
		if (!isBotCommand(newCommand) || newCommand.data.name !== loadedCommand.data.name) {
			throw new Error("Reloaded command is invalid.");
		}
		// Set the commands to the client commands collection
		interaction.client.commands.set(newCommand.data.name, newCommand);
		await interaction.reply(
			`Command \`/${newCommand.data.name}\` was reloaded!`,
		).catch((error: unknown) => logger.warn("Command reloaded, but confirmation could not be sent:", error));
	}
	catch (error) {
		logger.error("Error reloading command:", error);
		await respondWithError(interaction, `Could not reload /${loadedCommand.data.name}. The existing command has been kept.`);
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
