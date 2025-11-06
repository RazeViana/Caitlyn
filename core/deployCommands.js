/**
 * @file deployCommands.js
 * @description This script is responsible for dynamically loading and deploying Discord bot slash commands to a specific guild.
 * It reads command files from a structured directory, validates their structure, and registers them with the Discord API.
 *
 * The command files are expected to export an object containing `data` (command metadata) and `execute` (command logic) properties.
 * If a command file is missing these properties, a warning is logged to the console.
 *
 * The script uses the Discord.js REST API to refresh all application (/) commands for the specified guild.
 *
 * @module deployCommands
 */

import { REST, Routes } from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import logger from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const commands = [];
// Grab all the command folders from the commands directory you created earlier
const foldersPath = path.join(__dirname, "../commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	// Grab all the command files from the commands directory you created earlier
	const commandsPath = path.join(foldersPath, folder);
	const commandFiles = fs
		.readdirSync(commandsPath)
		.filter((file) => file.endsWith(".js"));
	// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const fileUrl = new URL(`file://${filePath}`);
		const command = await import(fileUrl.href);
		if ("data" in command && "execute" in command) {
			commands.push(command.data.toJSON());
		} else {
			logger.warn(
				`The command at ${filePath} is missing a required "data" or "execute" property.`
			);
		}
	}
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(TOKEN);

// and deploy your commands!
(async () => {
	try {
		logger.info(
			`Started refreshing ${commands.length} application (/) commands.`
		);
		// This clears the commands from the guild
		// await rest.put(
		// 	Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
		// 	{ body: [] } // ← clears all commands for that guild
		// );

		await rest.put(
			Routes.applicationCommands(CLIENT_ID),
			{ body: [] } // ← clears all global commands
		);

		// The put method is used to fully refresh all commands in the guild with the current set
		const data = await rest.put(
			Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
			{
				body: commands,
			}
		);

		logger.success(
			`Successfully reloaded ${data.length} application (/) commands.`
		);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		logger.error("Error deploying commands:", error);
	}
})();
