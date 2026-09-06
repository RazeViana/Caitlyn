/**
 * @file birthdayScheduledEvent.ts
 * @description Checks for due birthday reminders on startup and every five minutes.
 * Prevents overlapping recovery runs, scopes failure logs, and stops new sends during shutdown.
 *
 * @module birthdayScheduledEvent
 */

import cron, { type ScheduledTask } from "node-cron";
import { birthdayReminderMessage } from "../messages/birthdayReminderMessage.js";
import logger from "../core/logger.js";
import { withLogGuild } from "../core/logContext.js";
import { birthdayTimezone } from "../core/birthdayClock.js";
import type { Client } from "discord.js";

export interface BirthdayScheduledEventDependencies {
	birthdayReminderMessage: (client: Client, stopped: () => boolean) => Promise<void>;
	info: (...args: unknown[]) => void;
	schedule: (expression: string, callback: () => Promise<void>, options: { noOverlap: boolean }) => Pick<ScheduledTask, "destroy"> | undefined;
}

const defaultBirthdayScheduledEventDependencies: BirthdayScheduledEventDependencies = {
	birthdayReminderMessage,
	info: logger.info,
	schedule: (expression, callback, options) => cron.schedule(expression, callback, options),
};

// The reminder itself enforces 9 AM and the same-day window in its configured timezone.
function startBirthdayScheduledEvent(
	client: Client,
	dependencies: BirthdayScheduledEventDependencies = defaultBirthdayScheduledEventDependencies,
): () => Promise<void> {
	let active: Promise<void> | undefined;
	let stopped = false;
	const run = async (): Promise<void> => {
		if (stopped || active) return;
		active = withLogGuild(process.env.GUILD_ID, async () => {
			try {
				await dependencies.birthdayReminderMessage(client, () => stopped);
			}
			catch (error) {
				logger.error("Birthday recovery check failed; will retry on the next five-minute check:", error);
				throw error;
			}
		});
		try {
			await active;
		}
		finally {
			active = undefined;
		}
	};
	const task = dependencies.schedule("*/5 * * * *", run, { noOverlap: true });

	// Log the scheduled event
	withLogGuild(process.env.GUILD_ID, () => dependencies.info(
		`Birthday recovery started: checking on startup and every five minutes; due after 9 AM (${birthdayTimezone()})`,
	));
	void run().catch(() => undefined);
	return async () => {
		stopped = true;
		await task?.destroy();
		await active?.catch(() => undefined);
	};
}

export { startBirthdayScheduledEvent };
