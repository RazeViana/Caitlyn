/**
 * @file addBirthday.js
 * @description This module defines a Discord slash command for setting a birthday reminder for a specified user.
 * It allows users to input a day, month, and year to store a birthday in a PostgreSQL database.
 * The command checks if a birthday is already set for the user and prevents duplicate entries.
 *
 * If successful, the birthday is stored in the database for future reminders.
 *
 * @module addBirthday
 */

import {
	SlashCommandBuilder,
	MessageFlags,
	userMention,
} from "discord.js";
import { pool } from "../../core/createPGPool.js";

export const cooldown = 5;
export const category = "user";
export const data = new SlashCommandBuilder()
		.setName("addbirthday")
		.setDescription("Sets a birthday reminder for the specified user")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user of the birthday you want to add")
				.setRequired(true)
		)
		.addIntegerOption((option) =>
			option
				.setName("day")
				.setDescription("The day of the birthday e.g. 28")
				.setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName("month")
				.setDescription("The month of the birthday")
				.setRequired(true)
				.addChoices(
					{ name: "January", value: "1" },
					{ name: "February", value: "2" },
					{ name: "March", value: "3" },
					{ name: "April", value: "4" },
					{ name: "May", value: "5" },
					{ name: "June", value: "6" },
					{ name: "July", value: "7" },
					{ name: "August", value: "8" },
					{ name: "September", value: "9" },
					{ name: "October", value: "10" },
					{ name: "November", value: "11" },
					{ name: "December", value: "12" }
				)
		)
		.addIntegerOption((option) =>
			option
				.setName("year")
				.setDescription("The year of the birthday e.g. 1997")
				.setRequired(true)
		);
export async function execute(interaction) {
		// Get the user for whom the birthday is being set
		const displayName = interaction.options.getUser("user").username;
		const userId = interaction.options.getUser("user").id;

		// Get the birthday details from the interaction options
		const day = interaction.options.getInteger("day");
		const month = interaction.options.getString("month");
		const year = interaction.options.getInteger("year");
		const birthdayDate = new Date(`${year}-${month}-${day}`);
		const birthday = new Date(`${year}-${month}-${day + 1}`)
			.toISOString()
			.split("T")[0];

		// Check if the birthday is valid
		if (year < 1900 || year > new Date().getFullYear() + 1) {
			return interaction.reply({
				content: "Please provide a valid year.",
				flags: MessageFlags.Ephemeral,
			});
		}

		if (
			isNaN(birthdayDate.getTime()) ||
			birthdayDate.getDate() !== day ||
			birthdayDate.getMonth() + 1 !== parseInt(month) ||
			birthdayDate.getFullYear() !== year
		) {
			// If the birthday is invalid, return an error message
			return interaction.reply({
				content: "Please provide a valid date.",
				flags: MessageFlags.Ephemeral,
			});
		}

		try {
			// Check if the user already has a birthday set
			const res = await pool.query(
				`SELECT * FROM discord.birthdays WHERE discord_id = ${userId}`
			);

			// If the user already has a birthday set, update the birthday
			if (res.rows[0]) {
				await pool.query(
					`UPDATE discord.birthdays SET dob = $1, name = $2 WHERE discord_id = $3`,
					[birthday, displayName, userId]
				);

				// If the birthday was updated successfully, return a message
				return interaction.reply({
					content: `Birthday updated for ${userMention(userId)}!`,
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch (error) {
			// If there was an error checking the database, log it and return a message
			console.error("Error checking existing birthday:", error);
			return null;
		}

		try {
			// Insert the birthday into the database
			await pool.query(
				`INSERT INTO discord.birthdays (discord_id, name, dob) VALUES ($1, $2, $3)`,
				[userId, displayName, birthday]
			);
		} catch (error) {
			// If there was an error inserting the birthday, log it and return a message
			console.error("Error inserting birthday:", error);
			return interaction.reply({
				content: "There was an error setting the birthday reminder.",
				flags: MessageFlags.Ephemeral,
			});
		}
}
