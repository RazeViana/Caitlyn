/**
 * @file birthdayScheduledEvent.ts
 * @description Schedules birthday reminders for 9 AM in the host's local timezone.
 * Prevents overlapping runs and waits for an active reminder during shutdown.
 *
 * @module birthdayScheduledEvent
 */

import cron, { type ScheduledTask } from "node-cron";
import { birthdayReminderMessage } from "../messages/birthdayReminderMessage.js";
import logger from "../core/logger.js";
import type { Client } from "discord.js";

export interface BirthdayScheduledEventDependencies {
	birthdayReminderMessage: (client: Client) => Promise<void>;
	info: (...args: unknown[]) => void;
	schedule: (expression: string, callback: () => Promise<void>, options: { noOverlap: boolean }) => Pick<ScheduledTask, "destroy"> | undefined;
}

const defaultBirthdayScheduledEventDependencies: BirthdayScheduledEventDependencies = {
	birthdayReminderMessage,
	info: logger.info,
	schedule: (expression, callback, options) => cron.schedule(expression, callback, options),
};

// Start the cron job to run every day at 9 AM
function startBirthdayScheduledEvent(
	client: Client,
	dependencies: BirthdayScheduledEventDependencies = defaultBirthdayScheduledEventDependencies,
): () => Promise<void> {
	let active: Promise<void> | undefined;
	let stopped = false;
	const task = dependencies.schedule("0 9 * * *", async () => {
		if (stopped || active) return;
		active = dependencies.birthdayReminderMessage(client);
		try {
			await active;
		}
		finally {
			active = undefined;
		}
	}, { noOverlap: true });

	// Log the scheduled event
	dependencies.info(
		"Birthday scheduled event started, running every day at 9 AM.",
	);
	return async () => {
		stopped = true;
		await task?.destroy();
		await active?.catch(() => undefined);
	};
}

export { startBirthdayScheduledEvent };
