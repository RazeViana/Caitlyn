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
		if (prepared.created) logger.info(`Birthday recovery queued ${prepared.created} recipient(s) for ${window.date} (${timezone})`);
		if (prepared.expired) logger.warn(`Birthday recovery expired ${prepared.expired} unsent announcement(s); older birthdays will not be replayed`);
		const pending = await store.pending(dependencies.guildId(), window.date);
		logger.debug(`Birthday check ${window.date}: ${pending.length} due delivery/reconciliation batch(es)`);
		for (const delivery of pending) {
			if (!canSend()) break;
			const label = `Birthday delivery ${delivery.id} (${delivery.occurrence_date})`;
			// Recovery claims never become send claims, even when history has no match.
			if (delivery.status !== "ready" && !await store.claimRecovery(delivery.id)) continue;
			let channel: BirthdayChannel;
			try {
				channel = await dependencies.channel(client, delivery);
			}
			catch (error) {
				if (delivery.status === "ready") await store.defer(delivery.id);
				logger.warn(`${label}: channel unavailable; retry is delayed`, error);
				continue;
			}
			if (!canSend()) break;
			if (delivery.status !== "ready") {
				try {
					const messageId = await channel.find(delivery);
					if (messageId) {
						if (await store.sent(delivery.id, messageId)) logger.success(`${label}: recovered an existing Discord message; no duplicate sent`);
					}
					else {
						logger.warn(`${label}: delivery remains uncertain; no matching message in the bounded history scan. Automatic resend withheld; operator review may be needed`);
					}
				}
				catch (error) {
					logger.error(`${label}: reconciliation failed; automatic resend remains blocked`, error);
				}
				continue;
			}
			if (!await store.claim(delivery.id)) {
				logger.debug(`${label}: already claimed or completed by another worker`);
				continue;
			}
			if (!canSend()) {
				await store.releaseUnsent(delivery.id);
				logger.warn(`${label}: unsent claim released because the delivery window closed or the bot stopped; only same-day retry is allowed`);
				continue;
			}
			logger.info(`${label}: sending ${delivery.recipient_ids.length} birthday greeting(s)`);
			// Keep observing the original request after our deadline; late success must be recorded.
			const completion = (async () => channel.send(delivery))().then(async (messageId) => {
				try {
					if (await store.sent(delivery.id, messageId)) logger.success(`${label}: sent successfully (message ${messageId})`);
				}
				catch (error) {
					logger.error(`${label}: Discord accepted message ${messageId}, but recording delivery failed; history reconciliation is required`, error);
				}
			}, async (error: unknown) => {
				logger.error(`${label}: Discord send failed; delivery is uncertain and will be checked before any further action`, error);
				try { await store.uncertain(delivery.id); }
				catch (failure) { logger.error(`${label}: unable to record uncertain status; the persisted send claim still blocks duplicates`, failure); }
			});
			try {
				await withTimeout(completion, dependencies.deliveryTimeout, "Birthday delivery");
			}
			catch (error) {
				logger.warn(`${label}: delivery deadline reached; no automatic resend`, error);
				await store.uncertain(delivery.id);
			}
		}
	});
}

export const birthdayReminderMessage = createBirthdayReminder();
