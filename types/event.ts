import type { ClientEvents } from "discord.js";

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
	execute: (...args: ClientEvents[K]) => Promise<unknown> | unknown;
	name: K;
	once?: boolean;
}

export function isBotEvent(value: unknown): value is BotEvent {
	if (typeof value !== "object" || value === null) return false;

	const event = value as Record<string, unknown>;
	return typeof event.name === "string"
		&& typeof event.execute === "function"
		&& (event.once === undefined || typeof event.once === "boolean");
}
