/**
 * @file createClient.ts
 * @description Creates a Discord.js client with the requested gateway intents and persistent cooldowns.
 * Keeps shared errors and bounded gateway recovery diagnostics in the operator log scope.
 *
 * @module createClient
 */

import { Client, Collection, Partials, type GatewayIntentBits } from "discord.js";
import logger from "./logger.js";
import { withLogGuild } from "./logContext.js";
import { watchDiscordGateway } from "./discordGatewayHealth.js";

function createClient(intents: GatewayIntentBits[]): Client {
	// Create a new client instance
	const client = new Client({
		intents: intents,
		partials: [Partials.Message],
	});
	client.cooldowns = new Collection();
	client.on("error", (error) => withLogGuild(undefined, () => logger.error("Discord client error:", error)));
	const stopGatewayLogging = watchDiscordGateway(client);
	const destroy = client.destroy.bind(client);
	client.destroy = async () => {
		stopGatewayLogging();
		await destroy();
	};

	// Check if the client is defined
	if (!client) {
		throw new Error("Client is not defined");
	}

	logger.success("Created Discord client instance");
	return client;
}

export { createClient };
