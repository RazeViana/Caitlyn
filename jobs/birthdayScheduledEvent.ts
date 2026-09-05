/**
 * @file birthdayScheduledEvent.js
 * @description This module schedules a daily cron job to send birthday messages using a Discord bot.
 *
 * @module birthdayScheduledEvent
 */

import cron from "node-cron";
import { birthdayReminderMessage } from "../messages/birthdayReminderMessage.js";
import logger from "../core/logger.js";
import type { Client } from "discord.js";

export interface BirthdayScheduledEventDependencies {
	birthdayReminderMessage: (client: Client) => Promise<void>;
	info: (...args: unknown[]) => void;
	schedule: (expression: string, callback: () => Promise<void>) => unknown;
}

const defaultBirthdayScheduledEventDependencies: BirthdayScheduledEventDependencies = {
	birthdayReminderMessage,
	info: logger.info,
	schedule: (expression, callback) => cron.schedule(expression, callback),
};

// Start the cron job to run every day at 9 AM
function startBirthdayScheduledEvent(
	client: Client,
	dependencies: BirthdayScheduledEventDependencies = defaultBirthdayScheduledEventDependencies,
): void {
	dependencies.schedule("0 9 * * *", () => dependencies.birthdayReminderMessage(client));

	// Log the scheduled event
	dependencies.info(
		"Birthday scheduled event started, running every day at 9 AM.",
	);
}

export { startBirthdayScheduledEvent };
