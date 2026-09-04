/**
 * @file cronJobHandler.js
 * @description This module provides functionality to schedule and manage cron jobs for a Discord bot.
 *
 * @module cronJobHandler
 */

import type { Client } from "discord.js";

const {
	startBirthdayScheduledEvent,
}: {
	startBirthdayScheduledEvent: (client: Client) => void;
} = require("../jobs/birthdayScheduledEvent.js");

function startCronJobs(client: Client): void {
	startBirthdayScheduledEvent(client);
}

export { startCronJobs };
