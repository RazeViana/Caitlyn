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
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Client } from "discord.js";
import logger from "../core/logger.js";

import { isBotEvent } from "../types/event.js";

async function eventHandler(
	client: Client,
	eventsRoot = fileURLToPath(new URL("../events", import.meta.url)),
): Promise<void> {
	// Get the events folder path
	const eventsPath = eventsRoot;
	const moduleExtension = path.extname(fileURLToPath(import.meta.url));
	// Get the files in the events folder and filter them to the current runtime extension
	const eventFiles = fs
		.readdirSync(eventsPath)
		.filter((file) => file.endsWith(moduleExtension));

	// Loop through each event file
	for (const file of eventFiles) {
		// Get the current event file path
		const filePath = path.join(eventsPath, file);
		// Import the event file
		const event: unknown = await import(pathToFileURL(filePath).href);
		// Check if the event has a name and an execute function
		if (!isBotEvent(event)) continue;

		if (event.once) {
			client.once(event.name, (...args) => event.execute(...args));
		}
		else {
			client.on(event.name, (...args) => event.execute(...args));
		}
	}
	// Log the loaded events
	logger.info(
		`Event Handler loaded ${eventFiles.length} events from the events folder.`,
	);
}

export { eventHandler };
