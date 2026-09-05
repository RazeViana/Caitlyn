/**
 * @file deployCommands.ts
 * @description Loads and deploys the bot's slash commands to a Discord guild.
 * @module deployCommands
 */

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REST, Routes, type SlashCommandBuilder } from "discord.js";
import { isBotCommand } from "../types/command.js";
import logger from "./logger.js";

export interface DeploymentEnvironment {
	CLIENT_ID?: string;
	GUILD_ID?: string;
	TOKEN?: string;
}

export interface DeployCommandsDependencies {
	commandsRoot?: string;
	rest?: REST;
}

interface DeploymentConfiguration {
	clientId: string;
	guildId: string;
	token: string;
}

function readDeploymentConfiguration(
	environment: DeploymentEnvironment,
): DeploymentConfiguration {
	function requireVariable(variable: keyof DeploymentEnvironment): string {
		const value = environment[variable];
		if (!value?.trim()) {
			throw new Error(`No ${variable} found. Set a ${variable} environment variable`);
		}
		return value;
	}

	return {
		clientId: requireVariable("CLIENT_ID"),
		guildId: requireVariable("GUILD_ID"),
		token: requireVariable("TOKEN"),
	};
}

async function collectCommands(
	commandsRoot: string,
): Promise<ReturnType<SlashCommandBuilder["toJSON"]>[]> {
	const commands: ReturnType<SlashCommandBuilder["toJSON"]>[] = [];
	const commandFolders = fs.readdirSync(commandsRoot);
	const moduleExtension = path.extname(fileURLToPath(import.meta.url));

	for (const folder of commandFolders) {
		const commandsPath = path.join(commandsRoot, folder);
		const commandFiles = fs
			.readdirSync(commandsPath)
			.filter((file) => file.endsWith(moduleExtension));

		for (const file of commandFiles) {
			const filePath = path.join(commandsPath, file);
			const command: unknown = await import(pathToFileURL(filePath).href);
			if (isBotCommand(command)) {
				commands.push(command.data.toJSON());
			}
			else {
				logger.warn(
					`The command at ${filePath} is missing a required "data" or "execute" property.`,
				);
			}
		}
	}

	return commands;
}

export async function deployCommands(
	environment: DeploymentEnvironment = process.env,
	dependencies: DeployCommandsDependencies = {},
): Promise<void> {
	const configuration = readDeploymentConfiguration(environment);
	const commandsRoot = dependencies.commandsRoot
		?? fileURLToPath(new URL("../commands", import.meta.url));
	const commands = await collectCommands(commandsRoot);
	const rest = dependencies.rest ?? new REST().setToken(configuration.token);

	logger.info(
		`Started refreshing ${commands.length} application (/) commands.`,
	);

	// This clears all global commands before refreshing the guild command set.
	await rest.put(
		Routes.applicationCommands(configuration.clientId),
		{ body: [] },
	);

	const data = await rest.put(
		Routes.applicationGuildCommands(
			configuration.clientId,
			configuration.guildId,
		),
		{
			body: commands,
		},
	) as unknown[];

	logger.success(
		`Successfully reloaded ${data.length} application (/) commands.`,
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void deployCommands().catch((error: unknown) => {
		logger.error("Error deploying commands:", error);
		process.exitCode = 1;
	});
}
