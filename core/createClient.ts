/**
 * @file createClient.ts
 * @description Creates a Discord.js client with the requested gateway intents and persistent cooldowns.
 * Keeps shared client and gateway errors in the operator log scope.
 *
 * @module createClient
 */

import { Client, Collection, Partials, type GatewayIntentBits } from "discord.js";
import logger from "./logger.js";
import { withLogGuild } from "./logContext.js";

function createClient(intents: GatewayIntentBits[]): Client {
	// Create a new client instance
	const client = new Client({
		intents: intents,
		partials: [Partials.Message],
	});
	client.cooldowns = new Collection();
	client.on("error", (error) => withLogGuild(undefined, () => logger.error("Discord client error:", error)));
	client.on("shardError", (error) => withLogGuild(undefined, () => logger.error("Discord gateway error:", error)));

	// Check if the client is defined
	if (!client) {
		throw new Error("Client is not defined");
	}

	logger.success("Created Discord client instance");
	return client;
}

export { createClient };
