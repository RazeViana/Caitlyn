/**
 * @file cronJobHandler.js
 * @description This module provides functionality to schedule and manage cron jobs for a Discord bot.
 *
 * @module cronJobHandler
 */

const cron = require("node-cron");
const birthdayScheduledEvent = require("../utils/birthdayScheduledEvent.js");

// Start the cron job to run every day at 9 AM
function startBirthdayScheduledEvent(client) {
	cron.schedule("0 9 * * *", () => {
		birthdayScheduledEvent(client);
	});

	// Log the scheduled event
	console.log(
		"[INFO] Birthday scheduled event started, running every day at 9 AM."
	);
}

module.exports = {
	startBirthdayScheduledEvent,
};
