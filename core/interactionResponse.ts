/**
 * @file interactionResponse.ts
 * @description Delivers best-effort command errors using the interaction's acknowledgement state.
 * Selects a reply, edit, or follow-up and logs failed delivery without throwing again.
 *
 * @module interactionResponse
 */

import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import logger from "./logger.js";

/** Error delivery is best-effort: an expired interaction must not cause another failure. */
export async function respondWithError(
	interaction: ChatInputCommandInteraction,
	content = "Something went wrong. Please try again shortly.",
): Promise<void> {
	try {
		if (interaction.replied) {
			await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
		}
		else if (interaction.deferred) {
			await interaction.editReply({ content, embeds: [], components: [] });
		}
		else {
			await interaction.reply({ content, flags: MessageFlags.Ephemeral });
		}
	}
	catch (error) {
		logger.warn("Could not deliver interaction error response:", error);
	}
}
