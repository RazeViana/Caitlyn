/**
 * @file cronJobHandler.ts
 * @description Starts scheduled bot jobs and exposes their asynchronous shutdown callback.
 *
 * @module cronJobHandler
 */

import { startBirthdayScheduledEvent } from "../jobs/birthdayScheduledEvent.js";
import type { Client } from "discord.js";

function startCronJobs(client: Client): () => Promise<void> {
	return startBirthdayScheduledEvent(client);
}

export { startCronJobs };
