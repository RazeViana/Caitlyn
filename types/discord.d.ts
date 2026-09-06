/**
 * @file discord.d.ts
 * @description Extends Discord.js client types with command and cooldown collections.
 *
 * @module discord.d
 */

import type { Collection } from "discord.js";
import type { BotCommand } from "./command.js";

declare module "discord.js" {
	interface Client {
		commands: Collection<string, BotCommand>;
		cooldowns: Collection<string, Collection<string, number>>;
	}
}
