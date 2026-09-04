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

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { REST, Routes, type SlashCommandBuilder } from "discord.js";
import "dotenv/config";
import type { BotCommand } from "../types/command.js";

const loadModule = createRequire(__filename);

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const commands: ReturnType<SlashCommandBuilder["toJSON"]>[] = [];
// Grab all the command folders from the commands directory you created earlier
const foldersPath = path.join(__dirname, "../commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	// Grab all the command files from the commands directory you created earlier
	const commandsPath = path.join(foldersPath, folder);
	const moduleExtension = path.extname(__filename);
	const commandFiles = fs
		.readdirSync(commandsPath)
		.filter((file) => file.endsWith(moduleExtension));
	// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = loadModule(filePath) as BotCommand;
		if ("data" in command && "execute" in command) {
			commands.push(command.data.toJSON());
		}
		else {
			console.log(
				`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`,
			);
		}
	}
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(TOKEN);

// and deploy your commands!
(async () => {
	try {
		console.log(
			`Started refreshing ${commands.length} application (/) commands.`,
		);
		// This clears the commands from the guild
		// await rest.put(
		// 	Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
		// 	{ body: [] } // ← clears all commands for that guild
		// );

		// ← clears all global commands
		await rest.put(
			Routes.applicationCommands(CLIENT_ID),
			{ body: [] },
		);

		// The put method is used to fully refresh all commands in the guild with the current set
		const data = (await rest.put(
			Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
			{
				body: commands,
			},
		)) as unknown[];

		console.log(
			`Successfully reloaded ${data.length} application (/) commands.`,
		);
	}
	catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error(error);
	}
})();
