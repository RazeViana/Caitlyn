/**
 * @file guildCreate.ts
 * @description Records server joins for the operator without posting private logging instructions.
 * Joining another server never configures a destination or sends logging setup messages there.
 *
 * @module guildCreate
 */

import { Events, type Guild } from "discord.js";
import logger from "../core/logger.js";

export const name = Events.GuildCreate;
export function execute(guild: Guild): void {
	if (!guild.client.isReady()) return;
	logger.info(`Joined Discord server ${guild.name} (${guild.id})`);
}
