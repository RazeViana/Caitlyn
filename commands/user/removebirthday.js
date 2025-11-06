/**
 * @file removeBirthday.js
 * @description This module defines a Discord slash command for removing a user's birthday reminder from the database.
 * It allows users to specify a target user whose birthday reminder should be deleted. The command checks if the
 * specified user has a birthday set in the database and removes it if found.
 *
 * The command uses a PostgreSQL database to store and manage birthday reminders.
 *
 * @module removeBirthday
 */

import {
	SlashCommandBuilder,
	MessageFlags,
	userMention,
} from "discord.js";
import { pool } from "../../core/createPGPool.js";
import logger from "../../core/logger.js";

export const cooldown = 5;
export const category = "user";
export const data = new SlashCommandBuilder()
	.setName("removebirthday")
	.setDescription("Removes a birthday")
	.addUserOption((option) =>
		option
			.setName("user")
			.setDescription("The birthday reminder of the user you want to remove")
			.setRequired(true)
	);
export async function execute(interaction) {
		const displayName = interaction.options.getUser("user").username;
		const userId = interaction.options.getUser("user").id;

		try {
			// Check if the user has a birthday set
			const res = await pool.query(
				`SELECT * FROM discord.birthdays WHERE discord_id = ${userId}`
			);

			// If the user already has a birthday set, delete it
			if (res.rows[0]) {
				await pool.query(
					`DELETE FROM discord.birthdays WHERE discord_id = ${userId}`
				);

				// If the birthday was successfully deleted, return a message
				return interaction.reply({
					content: `Birthday reminder for ${userMention(
						userId
					)} has been deleted.`,
					flags: MessageFlags.Ephemeral,
				});
			} else {
				// If the user does not have a birthday set, return a message
				return interaction.reply({
					content: `${userMention(userId)} does not have a birthday set.`,
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch (error) {
			// If there was an error checking the database, log it and return a message
			logger.error("Error checking existing birthday:", error);
		}
}
