/**
 * @file createClient.ts
 * @description Creates a Discord.js client with the requested gateway intents and persistent cooldowns.
 * Attaches client and gateway error listeners so connection errors are logged.
 *
 * @module createClient
 */

import { Client, Collection, type GatewayIntentBits } from "discord.js";
import logger from "./logger.js";

function createClient(intents: GatewayIntentBits[]): Client {
	// Create a new client instance
	const client = new Client({
		intents: intents,
	});
	client.cooldowns = new Collection();
	client.on("error", (error) => logger.error("Discord client error:", error));
	client.on("shardError", (error) => logger.error("Discord gateway error:", error));

	// Check if the client is defined
	if (!client) {
		throw new Error("Client is not defined");
	}

	logger.success("Created Discord client instance");
	return client;
}

export { createClient };
