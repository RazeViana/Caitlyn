/**
 * @file cronJobHandler.js
 * @description This module provides functionality to schedule and manage cron jobs for a Discord bot.
 *
 * @module cronJobHandler
 */

const birthdayScheduledEvent = require("../jobs/birthdayScheduledEvent.js");

function startCronJobs(client) {
	birthdayScheduledEvent(client);
}
module.exports = {
	startCronJobs,
};
