/**
 * @file cronJobHandler.js
 * @description This module provides functionality to schedule and manage cron jobs for a Discord bot.
 *
 * @module cronJobHandler
 */

const {
	startBirthdayScheduledEvent,
} = require("../jobs/birthdayScheduledEvent.js");

function startCronJobs(client) {
	startBirthdayScheduledEvent(client);
}
module.exports = {
	startCronJobs,
};
