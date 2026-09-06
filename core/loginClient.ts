/**
 * @file loginClient.ts
 * @description This module provides a function to log in a Discord bot client using a token stored in environment variables.
 * It ensures that the required token is set and validates the client object before attempting to log in.
 * If the token is missing or the client is undefined, appropriate errors are thrown.
 * Login is awaited with a deadline; failures propagate to startup cleanup.
 *
 * @module loginClient
 */

import "dotenv/config";

import type { Client } from "discord.js";
import { withTimeout } from "./asyncTools.js";

async function loginClient(client: Client): Promise<void> {
	if (!process.env.TOKEN?.trim()) {
		throw new Error("No TOKEN found. Set a TOKEN environment variable");
	}

	// Check if the client is defined
	if (!client) {
		throw new Error("Client is not defined");
	}
	await withTimeout(client.login(process.env.TOKEN), 30_000, "Discord login");
}

export { loginClient };
