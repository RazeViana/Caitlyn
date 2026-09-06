/**
 * @file logContext.ts
 * @description Carries server ownership across asynchronous log-producing work.
 * Keeps concurrent Discord events isolated without changing logger call sites.
 *
 * @module logContext
 */

import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<string | undefined>();

export function withLogGuild<T>(guildId: string | undefined, operation: () => T): T {
	return context.run(guildId, operation);
}

export function currentLogGuild(): string | undefined {
	return context.getStore();
}

export function eventLogGuild(event: string, args: readonly unknown[]): string | undefined {
	for (const argument of args) {
		if (!argument || typeof argument !== "object") continue;
		const value = argument as { guildId?: unknown; guild?: { id?: unknown }; id?: unknown };
		const id = value.guildId ?? value.guild?.id
			?? (["guildCreate", "guildDelete"].includes(event) ? value.id : undefined);
		if (typeof id === "string") return id;
	}
	return undefined;
}
