/**
 * @file interactionResponse.ts
 * @description Acknowledges commands promptly and contains expired interaction responses.
 * Prevents expired commands from mutating state or making repeated invalid response requests.
 *
 * @module interactionResponse
 */

import { MessageFlags, type ChatInputCommandInteraction, type InteractionDeferReplyOptions } from "discord.js";
import logger from "./logger.js";

const unavailable = new WeakSet<object>();
type InteractionState = { createdTimestamp?: number; commandName?: string; deferred?: boolean; replied?: boolean };

/** A late/rejected acknowledgement cannot be recovered by posting another initial response. */
export function skipUnavailableInteraction(interaction: InteractionState, error?: unknown): boolean {
	if (unavailable.has(interaction)) return true;
	const code = (error as { code?: unknown } | undefined)?.code;
	const age = typeof interaction.createdTimestamp === "number" ? Math.max(0, Date.now() - interaction.createdTimestamp) : undefined;
	const expired = !interaction.deferred && !interaction.replied && age !== undefined && age >= 3_000;
	if (!expired && code !== 10062 && code !== 10015 && code !== 40060) return false;
	unavailable.add(interaction);
	const reason = code === 40060 ? "Discord command already acknowledged; check for duplicate bot instances" : "Discord interaction expired; retry the command";
	logger.warn(reason, interaction.commandName ?? "unknown",
		`age_ms=${age ?? "unknown"}`, `code=${code ?? "late_gateway_event"}`);
	return true;
}

export async function deferInteraction(interaction: ChatInputCommandInteraction, options?: InteractionDeferReplyOptions): Promise<boolean> {
	if (skipUnavailableInteraction(interaction)) return false;
	try {
		await interaction.deferReply(options);
		const age = typeof interaction.createdTimestamp === "number" ? Date.now() - interaction.createdTimestamp : undefined;
		logger.debug("Discord command acknowledged", interaction.commandName, `age_ms=${age ?? "unknown"}`);
		return true;
	}
	catch (error) {
		if (skipUnavailableInteraction(interaction, error)) return false;
		throw error;
	}
}

/** Error delivery is best-effort: an expired interaction must not cause another failure. */
export async function respondWithError(
	interaction: ChatInputCommandInteraction,
	content = "Something went wrong. Please try again shortly.",
): Promise<void> {
	if (skipUnavailableInteraction(interaction)) return;
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
		if (skipUnavailableInteraction(interaction, error)) return;
		logger.warn("Could not deliver interaction error response:", error);
	}
}
