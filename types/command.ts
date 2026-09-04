import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
} from "discord.js";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";

interface CommandData {
	readonly name: string;
	toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

export interface BotCommand {
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<unknown>;
	category: string;
	cooldown?: number;
	data: CommandData;
	execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
}
