/**
 * @file interactionCreate.ts
 * @description This module handles the `interactionCreate` event for a Discord.js bot.
 * It processes user interactions, executes commands, and enforces cooldowns to prevent spamming.
 *
 * The event listener ensures that commands are properly executed, handles errors gracefully,
 * and provides feedback to users when commands are unavailable or on cooldown.
 *
 * @module interactionCreate
 */

import { Collection, Events, PermissionFlagsBits, type Interaction } from "discord.js";
import logger from "../core/logger.js";
import { respondWithError, skipUnavailableInteraction } from "../core/interactionResponse.js";
import { getFeatureConfiguration } from "../core/environment.js";

export const name = Events.InteractionCreate;
export async function execute(interaction: Interaction): Promise<unknown> {
	// Check if the interaction is an autocomplete interaction
	if (interaction.isAutocomplete()) {
		if (skipUnavailableInteraction(interaction)) return;
		const command = interaction.client.commands.get(interaction.commandName);
		if (!command || typeof command.autocomplete !== "function") return;
		try {
			if (command.requiresDatabase && !getFeatureConfiguration().database.enabled) {
				await interaction.respond([]);
				return;
			}
			await command.autocomplete(interaction);
		}
		catch (error) {
			if (skipUnavailableInteraction(interaction, error)) return;
			logger.error(`Error in autocomplete for ${interaction.commandName}:`, error);
		}
		return;
	}

	// Check if the interaction is a command
	if (!interaction.isChatInputCommand()) return;
	if (skipUnavailableInteraction(interaction)) return;
	if (["reload", "toggleai", "setup", "logs"].includes(interaction.commandName)
		&& !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
		await respondWithError(interaction, "Only server administrators can use this command.");
		return;
	}

	// Get the command from the client
	const command = interaction.client.commands.get(interaction.commandName);
	// Check if the command exists
	if (!command) {
		logger.error(`No command matching ${interaction.commandName} was found.`);
		await respondWithError(interaction, "That command is currently unavailable. Please try again later.");
		return;
	}

	if (command.requiresDatabase && !getFeatureConfiguration().database.enabled) {
		await respondWithError(interaction, "This feature is disabled because database configuration is missing or invalid. Ask the operator to check the startup logs.");
		return;
	}

	// Create the cooldowns collection for the client
	interaction.client.cooldowns ??= new Collection();
	const cooldowns = interaction.client.cooldowns;

	// Check if the command is in the cooldowns collection
	if (!cooldowns.has(command.data.name)) {
		cooldowns.set(command.data.name, new Collection());
	}

	// Get the current timestamp
	const now = Date.now();
	// Get the timestamps collection for the command
	const timestamps = cooldowns.get(command.data.name);
	if (!timestamps) return;
	const defaultCooldownDuration = 3;
	// Set the cooldown duration if not specified in the command, otherwise use the command's cooldown
	const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

	// Check if the user is on cooldown
	const lastUsedAt = timestamps.get(interaction.user.id);
	if (lastUsedAt !== undefined) {
		const expirationTime = lastUsedAt + cooldownAmount;

		// If the user is on cooldown, calculate the expiration time
		if (now < expirationTime) {
			const expiredTimestamp = Math.round(expirationTime / 1000);
			await respondWithError(interaction, `Please wait, you are on a cooldown for \`${command.data.name}\`. You can use it again <t:${expiredTimestamp}:R>.`);
			return;
		}
	}

	// Set the cooldown for the user when they use the command
	timestamps.set(interaction.user.id, now);
	setTimeout(() => {
		if (timestamps.get(interaction.user.id) === now) timestamps.delete(interaction.user.id);
	}, cooldownAmount).unref();

	// Try to execute the command
	try {
		await command.execute(interaction);
	}
	catch (error) {
		if (skipUnavailableInteraction(interaction, error)) return;
		logger.error(`Error executing ${interaction.commandName}:`, error);
		await respondWithError(interaction);
	}
}
