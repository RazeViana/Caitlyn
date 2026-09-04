/**
 * @file birthdayScheduledEvent.ts
 * @description This module schedules a daily cron job to send birthday messages using a Discord bot.
 *
 * @module birthdayScheduledEvent
 */

import cron from "node-cron";
import type { Client } from "discord.js";
import { birthdayReminderMessage } from "../messages/birthdayReminderMessage.js";

// Start the cron job to run every day at 9 AM
function startBirthdayScheduledEvent(client: Client): void {
	cron.schedule("0 9 * * *", () => {
		void birthdayReminderMessage(client);
	});

	// Log the scheduled event
	console.log(
		"[INFO] Birthday scheduled event started, running every day at 9 AM.",
	);
}

export { startBirthdayScheduledEvent };
