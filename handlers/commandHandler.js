/**
 * @file command_handler.js
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
import { fileURLToPath } from "node:url";
import { Collection } from "discord.js";
import logger from "../core/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function commandHandler(client) {
	if (!client) throw new Error("Client is not defined");

	client.commands = new Collection();

	// Finds the commands folder path
	const foldersPath = path.join(__dirname, "../commands");
	// Reads the folders in the commands folder
	const commandFolders = fs.readdirSync(foldersPath);
	// Loops through each folder
	for (const folder of commandFolders) {
		// Reads the current commands folder path
		const commandsPath = path.join(foldersPath, folder);
		// Reads the files in the current commands folder and filters them to only include .js files
		const commandFiles = fs
			.readdirSync(commandsPath)
			.filter((file) => file.endsWith(".js"));
		// Loops through each command file
		for (const file of commandFiles) {
			// Reads the current command file path
			const filePath = path.join(commandsPath, file);
			// Imports the command file
			const fileUrl = new URL(`file://${filePath}`);
			const command = await import(fileUrl.href);

			// Set a new item in the Collection with the key as the command name and the value as the exported module
			if ("data" in command && "execute" in command) {
				client.commands.set(command.data.name, command);
			} else {
				logger.warn(
					`The command at ${filePath} is missing a required "data" or "execute" property.`
				);
			}
		}
	}
	// Log the loaded commands
	logger.info(
		`Command Handler loaded ${client.commands.size} commands from ${commandFolders.length} folders.`
	);
}

export { commandHandler };
