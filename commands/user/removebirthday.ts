/**
 * @file removebirthday.ts
 * @description Removes a user's birthday with a parameterized PostgreSQL delete.
 * Acknowledges before database work and distinguishes missing birthdays from service failures.
 *
 * @module removebirthday
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

interface BirthdayQueryResult {
	rows: Array<Record<string, unknown>>;
}

export interface RemoveBirthdayDependencies {
	query: (...args: [string, ...unknown[]]) => Promise<BirthdayQueryResult>;
}

const defaultRemoveBirthdayDependencies: RemoveBirthdayDependencies = {
	query: (...args) => Reflect.apply(pool.query, pool, args) as Promise<BirthdayQueryResult>,
};

export const cooldown = 5;
export const category = "user";
export const data = new SlashCommandBuilder()
	.setName("removebirthday")
	.setDescription("Removes a birthday")
	.addUserOption((option) =>
		option
			.setName("user")
			.setDescription("The birthday reminder of the user you want to remove")
			.setRequired(true),
	);
export async function execute(
	interaction: ChatInputCommandInteraction,
	dependencies: RemoveBirthdayDependencies = defaultRemoveBirthdayDependencies,
): Promise<void> {
	const user = interaction.options.getUser("user", true);
	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const result = await dependencies.query(
			"DELETE FROM discord.birthdays WHERE discord_id = $1 RETURNING discord_id", [user.id],
		);
		await interaction.editReply({
			content: result.rows.length
				? `Birthday reminder for ${userMention(user.id)} has been deleted.`
				: `${userMention(user.id)} does not have a birthday set.`,
		});
	}
	catch (error) {
		logger.error("Could not remove birthday:", error);
		await respondWithError(interaction, "Could not remove the birthday. Please try again shortly.");
	}
}
