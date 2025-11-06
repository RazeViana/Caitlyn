/**
 * @file createClient.js
 * @description This module provides a function to create and configure a new Discord.js client instance.
 * It allows you to initialize a client with specific gateway intents, enabling the bot to listen to and respond
 * to various events on the Discord platform.
 *
 * The client is created using the `Client` class from the Discord.js library, and the required intents
 * are passed as an argument to the function.
 *
 * @module createClient
 */

import { Client } from "discord.js";

function createClient(intents) {
	// Create a new client instance
	const client = new Client({
		intents: intents,
	});

	// Check if the client is defined
	if (!client) {
		throw new Error("Client is not defined");
	}

	console.log("[INFO] Created discord client instance");
	return client;
}

export { createClient };
