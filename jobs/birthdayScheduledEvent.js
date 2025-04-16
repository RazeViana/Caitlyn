/**
 * @file birthdayScheduledEvent.js
 * @description This module schedules a daily cron job to send birthday messages using a Discord bot.
 *
 * @module birthdayScheduledEvent
 */

const cron = require("node-cron");
const {
	birthdayReminderMessage,
} = require("../messages/birthdayReminderMessage.js");

// Start the cron job to run every day at 9 AM
function startBirthdayScheduledEvent(client) {
	cron.schedule("0 9 * * *", () => {
		birthdayReminderMessage(client);
	});

	// Log the scheduled event
	console.log(
		"[INFO] Birthday scheduled event started, running every day at 9 AM."
	);
}

module.exports = { startBirthdayScheduledEvent };
