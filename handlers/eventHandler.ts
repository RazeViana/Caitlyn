/**
 * @file eventHandler.ts
 * @description Discovers and validates Discord event modules before registering guarded listeners.
 * Contains event failures and drains accepted work when shutdown stops new events.
 *
 * @module eventHandler
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Client } from "discord.js";
import logger from "../core/logger.js";

import { isBotEvent } from "../types/event.js";

const eventWork = new WeakMap<Client, { accepting: boolean; pending: Set<Promise<void>> }>();

export async function drainEvents(client: Client): Promise<void> {
	const state = eventWork.get(client);
	if (!state) return;
	state.accepting = false;
	await Promise.allSettled([...state.pending]);
}

async function eventHandler(
	client: Client,
	eventsRoot = fileURLToPath(new URL("../events", import.meta.url)),
): Promise<void> {
	const state = { accepting: true, pending: new Set<Promise<void>>() };
	eventWork.set(client, state);
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
		const listener = (...args: Parameters<typeof event.execute>): void => {
			if (!state.accepting) return;
			const operation = Promise.resolve().then(() => event.execute(...args)).then(
				() => undefined,
				(error: unknown) => logger.error(`Error handling Discord event ${event.name}:`, error),
			);
			state.pending.add(operation);
			void operation.then(() => state.pending.delete(operation));
		};

		if (event.once) {
			client.once(event.name, listener);
		}
		else {
			client.on(event.name, listener);
		}
	}
	// Log the loaded events
	logger.info(
		`Event Handler loaded ${eventFiles.length} events from the events folder.`,
	);
}

export { eventHandler };
