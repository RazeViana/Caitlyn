/**
 * @file cronJobHandler.js
 * @description This module provides functionality to schedule and manage cron jobs for a Discord bot.
 *
 * @module cronJobHandler
 */

import { startBirthdayScheduledEvent } from "../jobs/birthdayScheduledEvent.js";

function startCronJobs(client) {
	startBirthdayScheduledEvent(client);
}

export { startCronJobs };
