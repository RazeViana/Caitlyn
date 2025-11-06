/**
 * @file interactionCreate.js
 * @description This module handles the `interactionCreate` event for a Discord.js bot.
 * It processes user interactions, executes commands, and enforces cooldowns to prevent spamming.
 *
 * The event listener ensures that commands are properly executed, handles errors gracefully,
 * and provides feedback to users when commands are unavailable or on cooldown.
 *
 * @module interactionCreate
 */

import { Events, Collection } from "discord.js";
import logger from "../core/logger.js";

export const name = Events.InteractionCreate;
export async function execute(interaction) {
		// Check if the interaction is an autocomplete interaction
		if (interaction.isAutocomplete()) {
			const command = interaction.client.commands.get(interaction.commandName);
			if (!command || typeof command.autocomplete !== "function") return;
			try {
				await command.autocomplete(interaction);
			} catch (error) {
				logger.error(`Error in autocomplete for ${interaction.commandName}:`, error);
			}
			return;
		}

		// Check if the interaction is a command
		if (!interaction.isChatInputCommand()) return;

		// Get the command from the client
		const command = interaction.client.commands.get(interaction.commandName);
		// Check if the command exists
		if (!command) {
			logger.error(`No command matching ${interaction.commandName} was found.`);
			return;
		}

		// Create the cooldowns collection for the client
		interaction.client.cooldowns = new Collection();
		const cooldowns = interaction.client.cooldowns;

		// Check if the command is in the cooldowns collection
		if (!cooldowns.has(command.data.name)) {
			cooldowns.set(command.data.name, new Collection());
		}

		// Get the current timestamp
		const now = Date.now();
		// Get the timestamps collection for the command
		const timestamps = cooldowns.get(command.data.name);
		const defaultCooldownDuration = 3;
		// Set the cooldown duration if not specified in the command, otherwise use the command's cooldown
		const cooldownAmount = (command.cooldown ?? defaultCooldownDuration) * 1000;

		// Check if the user is on cooldown
		if (timestamps.has(interaction.user.id)) {
			const expirationTime =
				timestamps.get(interaction.user.id) + cooldownAmount;

			// If the user is on cooldown, calculate the expiration time
			if (now < expirationTime) {
				const expiredTimestamp = Math.round(expirationTime / 1000);
				return interaction.reply({
					content: `Please wait, you are on a cooldown for \`${command.data.name}\`. You can use it again <t:${expiredTimestamp}:R>.`,
					ephemeral: true,
				});
			}
		}

		// Set the cooldown for the user when they use the command
		timestamps.set(interaction.user.id, now);
		setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

		// Try to execute the command
		try {
			await command.execute(interaction);
		} catch (error) {
			logger.error(`Error executing ${interaction.commandName}:`, error);
		}
}
