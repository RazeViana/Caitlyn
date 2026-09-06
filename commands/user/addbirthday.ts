/**
 * @file addbirthday.ts
 * @description Validates and saves a user's date-only birthday through an atomic PostgreSQL upsert.
 * Acknowledges before database work and confirms success or delivers a safe error response.
 *
 * @module addbirthday
 */

import {
	SlashCommandBuilder,
	MessageFlags,
	userMention,
	type ChatInputCommandInteraction,
} from "discord.js";
import { pool } from "../../core/createPGPool.js";
import logger from "../../core/logger.js";
import { respondWithError } from "../../core/interactionResponse.js";
import { birthdayDate } from "../../core/birthdayDate.js";

interface BirthdayQueryResult {
	rows: Array<Record<string, unknown>>;
}

export interface AddBirthdayDependencies {
	query: (...args: [string, ...unknown[]]) => Promise<BirthdayQueryResult>;
}

const defaultAddBirthdayDependencies: AddBirthdayDependencies = {
	query: (...args) => Reflect.apply(pool.query, pool, args) as Promise<BirthdayQueryResult>,
};

export const cooldown = 5;
export const category = "user";
export const data = new SlashCommandBuilder()
	.setName("addbirthday")
	.setDescription("Sets a birthday reminder for the specified user")
	.addUserOption((option) =>
		option
			.setName("user")
			.setDescription("The user of the birthday you want to add")
			.setRequired(true),
	)
	.addIntegerOption((option) =>
		option
			.setName("day")
			.setDescription("The day of the birthday e.g. 28")
			.setRequired(true),
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
				{ name: "December", value: "12" },
			),
	)
	.addIntegerOption((option) =>
		option
			.setName("year")
			.setDescription("The year of the birthday e.g. 1997")
			.setRequired(true),
	);
export async function execute(
	interaction: ChatInputCommandInteraction,
	dependencies: AddBirthdayDependencies = defaultAddBirthdayDependencies,
): Promise<void> {
	const user = interaction.options.getUser("user", true);
	const day = interaction.options.getInteger("day", true);
	const month = Number(interaction.options.getString("month", true));
	const year = interaction.options.getInteger("year", true);
	const dob = birthdayDate(year, month, day);
	if (!dob) {
		await respondWithError(interaction, "Please provide a valid birthday date (1900 through the current year).");
		return;
	}
	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await dependencies.query(
			"INSERT INTO discord.birthdays (discord_id, name, dob) VALUES ($1, $2, $3) ON CONFLICT (discord_id) DO UPDATE SET name = EXCLUDED.name, dob = EXCLUDED.dob",
			[user.id, user.username, dob],
		);
		await interaction.editReply({ content: `Birthday saved for ${userMention(user.id)}!` });
	}
	catch (error) {
		logger.error("Could not save birthday:", error);
		await respondWithError(interaction, "Could not save the birthday. Please try again shortly.");
	}
}
