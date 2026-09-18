/**
 * @file loginClient.ts
 * @description This module provides a function to log in a Discord bot client using a token stored in environment variables.
 * It ensures that the required token is set and validates the client object before attempting to log in.
 * If the token is missing or the client is undefined, appropriate errors are thrown.
 * Login and actual gateway readiness share one deadline; listeners are always cleaned up.
 *
 * @module loginClient
 */

import "./loadEnvironment.js";

import { Events, type Client } from "discord.js";
import { withTimeout } from "./asyncTools.js";

async function loginClient(client: Client, timeoutMs = 30_000): Promise<void> {
	if (!process.env.TOKEN?.trim()) {
		throw new Error("No TOKEN found. Set a TOKEN environment variable");
	}

	// Check if the client is defined
	if (!client) {
		throw new Error("Client is not defined");
	}
	if (client.isReady()) return;
	let ready!: () => void;
	const readiness = new Promise<void>((resolve) => { ready = resolve; });
	// Subscribe before login: clientReady may fire before the login promise settles.
	client.once(Events.ClientReady, ready);
	try {
		await withTimeout(Promise.all([client.login(process.env.TOKEN), readiness]), timeoutMs, "Connecting to Discord");
	}
	finally {
		client.off(Events.ClientReady, ready);
	}
}

export { loginClient };
