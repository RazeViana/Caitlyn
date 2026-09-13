/**
 * @file cronJobHandler.ts
 * @description Starts scheduled bot jobs and exposes their asynchronous shutdown callback.
 *
 * @module cronJobHandler
 */

import { startBirthdayScheduledEvent } from "../jobs/birthdayScheduledEvent.js";
import type { Client } from "discord.js";
import { getFeatureConfiguration } from "../core/environment.js";

function startCronJobs(client: Client): () => Promise<void> {
	if (!getFeatureConfiguration().birthdayReminders.enabled) return async () => undefined;
	return startBirthdayScheduledEvent(client);
}

export { startCronJobs };
