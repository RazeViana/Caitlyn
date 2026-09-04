/**
 * @file loginClient.ts
 * @description This module provides a function to log in a Discord bot client using a token stored in environment variables.
 * It ensures that the required token is set and validates the client object before attempting to log in.
 * If the token is missing or the client is undefined, appropriate errors are thrown.
 * Any errors encountered during the login process are caught and logged to the console.
 *
 * @module loginClient
 */

import "dotenv/config";
import type { Client } from "discord.js";

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
	throw new Error("No TOKEN found. Set a TOKEN environment variable");
}

function loginClient(client: Client): void {
	if (!client) {
		throw new Error("Client is not defined");
	}

	client.login(process.env.TOKEN).catch((error: unknown) => {
		console.error("Error logging in:", error);
	});
}

export { loginClient };
