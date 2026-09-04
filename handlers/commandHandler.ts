/**
 * @file commandHandler.ts
 * @description This module provides a function to dynamically load and register command files for a Discord bot client.
 * It reads command files from a structured directory, validates their structure, and adds them to the client's command collection.
 *
 * The command files are expected to export an object containing `data` (command metadata) and `execute` (command logic) properties.
 * If a command file is missing these properties, a warning is logged to the console.
 *
 * @module command_handler
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Collection, type Client } from "discord.js";
import logger from "../core/logger.js";

import { isBotCommand } from "../types/command.js";

async function commandHandler(
	client: Client,
	commandsRoot = fileURLToPath(new URL("../commands", import.meta.url)),
): Promise<void> {
	if (!client) throw new Error("Client is not defined");

	client.commands = new Collection();

	// Finds the commands folder path
	const foldersPath = commandsRoot;
	const moduleExtension = path.extname(fileURLToPath(import.meta.url));
	// Reads the folders in the commands folder
	const commandFolders = fs.readdirSync(foldersPath);
	// Loops through each folder
	for (const folder of commandFolders) {
		// Reads the current commands folder path
		const commandsPath = path.join(foldersPath, folder);
		// Reads the files in the current commands folder and filters them to the current runtime extension
		const commandFiles = fs
			.readdirSync(commandsPath)
			.filter((file) => file.endsWith(moduleExtension));
		// Loops through each command file
		for (const file of commandFiles) {
			// Reads the current command file path
			const filePath = path.join(commandsPath, file);
			// Imports the command file
			const command: unknown = await import(pathToFileURL(filePath).href);

			// Set a new item in the Collection with the key as the command name and the value as the exported module
			if (isBotCommand(command)) {
				client.commands.set(command.data.name, command);
			}
			else {
				logger.warn(
					`The command at ${filePath} is missing a required "data" or "execute" property.`,
				);
			}
		}
	}
	// Log the loaded commands
	logger.info(
		`Command Handler loaded ${client.commands.size} commands from ${commandFolders.length} folders.`,
	);
}

export { commandHandler };
