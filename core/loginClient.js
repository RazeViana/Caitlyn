/**
 * @file loginClient.js
 * @description This module provides a function to log in a Discord bot client using a token stored in environment variables.
 * It ensures that the required token is set and validates the client object before attempting to log in.
 * If the token is missing or the client is undefined, appropriate errors are thrown.
 * Any errors encountered during the login process are caught and logged to the console.
 *
 * @module loginClient
 */

require("dotenv").config();

const TOKEN = process.env.TOKEN;

// Check if the TOKEN is set
if (!TOKEN) {
	throw new Error("No TOKEN found. Set a TOKEN environment variable");
}

function loginClient(client) {
	// Check if the client is defined
	if (!client) {
		throw new Error("Client is not defined");
	}
	// Try to log in the client and catch any errors
	client.login(process.env.TOKEN).catch((error) => {
		console.error("Error logging in:", error);
	});
}

module.exports = { loginClient };
