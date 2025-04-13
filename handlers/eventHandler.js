/**
 * @file eventHandler.js
 * @description This module provides a function to dynamically load and register event files for a Discord bot client.
 * It reads event files from a structured directory, validates their structure, and attaches them to the client's event listeners.
 *
 * The event files are expected to export an object containing `name` (event name), `execute` (event logic), and optionally `once` (boolean to indicate one-time execution) properties.
 * If an event file is missing these properties, it will not be registered.
 *
 * @module eventHandler
 */

const fs = require("node:fs");
const path = require("node:path");

function eventHandler(client) {
	// Get the events folder path
	const eventsPath = path.join(__dirname, "../events");
	// Get the files in the events folder and filter them to only include .js files
	const eventFiles = fs
		.readdirSync(eventsPath)
		.filter((file) => file.endsWith(".js"));

	// Loop through each event file
	for (const file of eventFiles) {
		// Get the current event file path
		const filePath = path.join(eventsPath, file);
		// Import the event file
		const event = require(filePath);
		// Check if the event has a name and an execute function
		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
		} else {
			client.on(event.name, (...args) => event.execute(...args));
		}
	}
	// Log the loaded events
	console.log(
		`[INFO] Event Handler loaded ${eventFiles.length} events from the events folder.`
	);
}

module.exports = { eventHandler };
