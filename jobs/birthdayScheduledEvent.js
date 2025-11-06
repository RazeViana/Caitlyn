/**
 * @file birthdayScheduledEvent.js
 * @description This module schedules a daily cron job to send birthday messages using a Discord bot.
 *
 * @module birthdayScheduledEvent
 */

import cron from "node-cron";
import { birthdayReminderMessage } from "../messages/birthdayReminderMessage.js";
import logger from "../core/logger.js";

// Start the cron job to run every day at 9 AM
function startBirthdayScheduledEvent(client) {
	cron.schedule("0 9 * * *", () => {
		birthdayReminderMessage(client);
	});

	// Log the scheduled event
	logger.info(
		"Birthday scheduled event started, running every day at 9 AM."
	);
}

export { startBirthdayScheduledEvent };
