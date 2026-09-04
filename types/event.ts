import type { ClientEvents } from "discord.js";

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
	execute: (...args: ClientEvents[K]) => Promise<unknown> | unknown;
	name: K;
	once?: boolean;
}
