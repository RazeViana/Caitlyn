/**
 * @file eventHandler.ts
 * @description This module provides a function to dynamically load and register event files for a Discord bot client.
 * It reads event files from a structured directory, validates their structure, and attaches them to the client's event listeners.
 *
 * The event files are expected to export an object containing `name` (event name), `execute` (event logic), and optionally `once` (boolean to indicate one-time execution) properties.
 * If an event file is missing these properties, it will not be registered.
 *
 * @module eventHandler
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Client } from "discord.js";
import type { BotEvent } from "../types/event.js";

const loadModule = createRequire(__filename);

function eventHandler(
	client: Client,
	eventsPath = path.join(__dirname, "../events"),
): void {
	// Get the events folder path
	const moduleExtension = path.extname(__filename);
	// Get the files in the events folder and filter them to only include the runtime extension
	const eventFiles = fs
		.readdirSync(eventsPath)
		.filter((file) => file.endsWith(moduleExtension));

	// Loop through each event file
	for (const file of eventFiles) {
		// Get the current event file path
		const filePath = path.join(eventsPath, file);
		// Import the event file
		const event = loadModule(filePath) as BotEvent;
		// Check if the event has a name and an execute function
		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
		}
		else {
			client.on(event.name, (...args) => event.execute(...args));
		}
	}
	// Log the loaded events
	console.log(
		`[INFO] Event Handler loaded ${eventFiles.length} events from the events folder.`,
	);
}

export { eventHandler };
