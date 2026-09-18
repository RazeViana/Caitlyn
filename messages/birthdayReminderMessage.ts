/**
 * @file birthdayReminderMessage.ts
 * @description Delivers same-day birthday catch-up using persisted claims and delivery reconciliation.
 * Logs recovery through the shared guild-scoped logger and never blindly resends an uncertain message.
 *
 * @module birthdayReminderMessage
 */

import type { Client } from "discord.js";
import { birthdayTimezone, birthdayWindow } from "../core/birthdayClock.js";
import { birthdayDeliveryStore, type BirthdayDelivery, type BirthdayDeliveryStore } from "../core/birthdayDeliveryStore.js";
import { withTimeout } from "../core/asyncTools.js";
import { withLogGuild } from "../core/logContext.js";
import logger from "../core/logger.js";
import { getBirthdayChannel, type BirthdayChannel } from "./birthdayDelivery.js";

interface BirthdayReminderDependencies {
	store: BirthdayDeliveryStore;
	channel: (client: Client, delivery: BirthdayDelivery) => Promise<BirthdayChannel>;
	now: () => Date;
	timezone: () => string;
	guildId: () => string;
	channelId: () => string;
	deliveryTimeout: number;
}

export function createBirthdayReminder(dependencies: BirthdayReminderDependencies = {
	store: birthdayDeliveryStore, channel: getBirthdayChannel, now: () => new Date(), timezone: birthdayTimezone,
	guildId: () => process.env.GUILD_ID, channelId: () => process.env.GENERAL_CHAT_ID, deliveryTimeout: 10_000,
}) {
	return async (client: Client, stopped: () => boolean = () => false): Promise<void> => withLogGuild(dependencies.guildId(), async () => {
		const { store } = dependencies;
		const timezone = dependencies.timezone();
		const window = birthdayWindow(dependencies.now(), timezone);
		const canSend = (): boolean => {
			const current = birthdayWindow(dependencies.now(), timezone);
			return !stopped() && client.isReady() && current.due && current.date === window.date;
		};
		if (!window.due || !canSend()) {
			logger.debug("Birthday check skipped: before 9 AM, Discord not ready, or stopping");
			return;
		}
		const prepared = await store.prepare(dependencies.guildId(), dependencies.channelId(), window.date);
		if (prepared.created) logger.info(`Birthday greetings added for ${prepared.created} person(s) on ${window.date} (${timezone})`);
		if (prepared.expired) logger.warn(`Skipped ${prepared.expired} unsent birthday message(s) from earlier days; only today's birthdays will be sent`);
		const pending = await store.pending(dependencies.guildId(), window.date);
		logger.debug(`Birthday check ${window.date}: ${pending.length} message group(s) to send or check for an earlier send`);
		for (const delivery of pending) {
			if (!canSend()) break;
			const label = `Birthday message ${delivery.id} (${delivery.occurrence_date})`;
			// Recovery claims never become send claims, even when history has no match.
			if (delivery.status !== "ready" && !await store.claimRecovery(delivery.id)) continue;
			let channel: BirthdayChannel;
			try {
				channel = await dependencies.channel(client, delivery);
			}
			catch (error) {
				if (delivery.status === "ready") await store.defer(delivery.id);
				logger.warn(`${label}: could not access the channel; will try again later`, error);
				continue;
			}
			if (!canSend()) break;
			if (delivery.status !== "ready") {
				try {
					const messageId = await channel.find(delivery);
					if (messageId) {
						if (await store.sent(delivery.id, messageId)) logger.success(`${label}: found the message already in Discord; no second copy sent`);
					}
					else {
						logger.warn(`${label}: could not find the message in recent Discord history. It may still have been sent, so no second copy will be sent. Please check the channel`);
					}
				}
				catch (error) {
					logger.error(`${label}: could not check whether the message was already sent; no second copy will be sent`, error);
				}
				continue;
			}
			if (!await store.claim(delivery.id)) {
				logger.debug(`${label}: already being handled or already sent; skipping this attempt`);
				continue;
			}
			if (!canSend()) {
				await store.releaseUnsent(delivery.id);
				logger.warn(`${label}: not sent because the bot is stopping, Discord is not ready, or the birthday has passed; can only try again today`);
				continue;
			}
			logger.info(`${label}: sending ${delivery.recipient_ids.length} birthday greeting(s)`);
			// Keep observing the original request after our deadline; late success must be recorded.
			const completion = (async () => channel.send(delivery))().then(async (messageId) => {
				try {
					if (await store.sent(delivery.id, messageId)) logger.success(`${label}: sent successfully (message ${messageId})`);
				}
				catch (error) {
					logger.error(`${label}: Discord received message ${messageId}, but the database could not save that it was sent; the next check will look for it in Discord`, error);
				}
			}, async (error: unknown) => {
				logger.error(`${label}: sending failed, but Discord may have received it; will check Discord before doing anything else`, error);
				try { await store.uncertain(delivery.id); }
				catch (failure) { logger.error(`${label}: could not save the send result; the saved record still prevents a second copy`, failure); }
			});
			try {
				await withTimeout(completion, dependencies.deliveryTimeout, "Birthday delivery");
			}
			catch (error) {
				logger.warn(`${label}: Discord took too long to confirm the send; no second copy will be sent`, error);
				await store.uncertain(delivery.id);
			}
		}
	});
}

export const birthdayReminderMessage = createBirthdayReminder();
