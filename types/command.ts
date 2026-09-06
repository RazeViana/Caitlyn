/**
 * @file command.ts
 * @description Defines the shared slash-command contract and its runtime module guard.
 *
 * @module command
 */

import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";

export interface BotCommand {
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
	category: string;
	cooldown?: number;
	data: {
		readonly name: string;
		toJSON(): ReturnType<SlashCommandBuilder["toJSON"]>;
	};
	execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
}

export function isBotCommand(value: unknown): value is BotCommand {
	if (typeof value !== "object" || value === null) return false;

	const command = value as Record<string, unknown>;
	if (typeof command.category !== "string" || typeof command.execute !== "function") {
		return false;
	}
	if (typeof command.data !== "object" || command.data === null) return false;

	const data = command.data as Record<string, unknown>;
	return typeof data.name === "string" && typeof data.toJSON === "function";
}
