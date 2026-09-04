import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";

interface CommandData {
	readonly name: string;
	toJSON(): ReturnType<SlashCommandBuilder["toJSON"]>;
}

export interface BotCommand {
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<unknown>;
	category: string;
	cooldown?: number;
	data: CommandData;
	execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
}
