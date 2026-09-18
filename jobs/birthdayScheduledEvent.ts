/**
 * @file birthdayScheduledEvent.ts
 * @description Checks for due birthday reminders on startup and every five minutes.
 * Coalesces missed ticks into same-day recovery, routes scheduler diagnostics, and drains safely.
 *
 * @module birthdayScheduledEvent
 */

import cron, { type ScheduledTask, type TaskContext, type TaskOptions } from "node-cron";
import { birthdayReminderMessage } from "../messages/birthdayReminderMessage.js";
import logger from "../core/logger.js";
import { withLogGuild } from "../core/logContext.js";
import { birthdayTimezone } from "../core/birthdayClock.js";
import { Events, type Client } from "discord.js";

export interface BirthdayScheduledEventDependencies {
	birthdayReminderMessage: (client: Client, stopped: () => boolean) => Promise<void>;
	info: (...args: unknown[]) => void;
	schedule: (expression: string, callback: () => Promise<void>, options: TaskOptions) =>
		(Pick<ScheduledTask, "destroy"> & Partial<Pick<ScheduledTask, "on" | "off" | "start">>) | undefined;
}

const defaultBirthdayScheduledEventDependencies: BirthdayScheduledEventDependencies = {
	birthdayReminderMessage,
	info: logger.info,
	schedule: (expression, callback, options) => cron.createTask(expression, callback, options),
};

// The reminder itself enforces 9 AM and the same-day window in its configured timezone.
function startBirthdayScheduledEvent(
	client: Client,
	dependencies: BirthdayScheduledEventDependencies = defaultBirthdayScheduledEventDependencies,
): () => Promise<void> {
	let active: Promise<void> | undefined;
	let stopped = false;
	let missed = 0;
	let earliestMissed = 0;
	let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
	const reportedErrors = new WeakSet<Error>();
	const scoped = (action: () => void): void => withLogGuild(process.env.GUILD_ID, action);
	const queueRecovery = (): void => {
		if (stopped || !missed || recoveryTimer) return;
		recoveryTimer = setTimeout(() => {
			recoveryTimer = undefined;
			if (stopped || active || client.isReady?.() === false) return;
			const count = missed;
			missed = 0;
			scoped(() => logger.warn("Birthday check was delayed; checking today's birthdays now", `missed checks: ${count}`, `delay: ${Math.max(0, Date.now() - earliestMissed)} ms`));
			void run().catch(() => undefined);
		}, 0);
		recoveryTimer.unref();
	};
	const defer = (date: Date): void => {
		if (stopped) return;
		if (!missed) earliestMissed = date.getTime();
		missed++;
		queueRecovery();
	};
	const run = async (): Promise<void> => {
		if (stopped || active) return;
		if (client.isReady?.() === false) {
			defer(new Date());
			return;
		}
		active = withLogGuild(process.env.GUILD_ID, async () => {
			try {
				await dependencies.birthdayReminderMessage(client, () => stopped);
			}
			catch (error) {
				if (error instanceof Error) reportedErrors.add(error);
				logger.error("Could not check birthdays; will try again at the next five-minute check:", error);
				throw error;
			}
		});
		try {
			await active;
		}
		finally {
			active = undefined;
			queueRecovery();
		}
	};
	const task = dependencies.schedule("*/5 * * * *", run, {
		noOverlap: true,
		logger: {
			info: (message) => scoped(() => logger.info("Automatic birthday checks:", message)),
			warn: (message) => scoped(() => logger.warn("Automatic birthday checks:", message)),
			debug: (message, error) => scoped(() => logger.debug("Automatic birthday checks:", message, error ?? "")),
			error: (message, error) => {
				const failure = error ?? (message instanceof Error ? message : undefined);
				if (failure && reportedErrors.has(failure)) return;
				scoped(() => logger.error("Automatic birthday checks:", message, error ?? ""));
			},
		},
	});
	const onMissed = (context: TaskContext): void => { defer(context.date); };
	task?.on?.("execution:missed", onMissed);
	client.on?.(Events.ClientReady, queueRecovery);
	client.on?.(Events.ShardResume, queueRecovery);
	client.on?.(Events.ShardReady, queueRecovery);
	// Attach missed-execution listeners before the real scheduler starts.
	void Promise.resolve(task?.start?.()).catch((error: unknown) => scoped(() => logger.error("Could not start automatic birthday checks:", error)));

	// Log the scheduled event
	withLogGuild(process.env.GUILD_ID, () => dependencies.info(
		`Birthday checks started: checking now and every five minutes; greetings are sent after 9 AM (${birthdayTimezone()})`,
	));
	void run().catch(() => undefined);
	return async () => {
		stopped = true;
		clearTimeout(recoveryTimer);
		task?.off?.("execution:missed", onMissed);
		client.off?.(Events.ClientReady, queueRecovery);
		client.off?.(Events.ShardResume, queueRecovery);
		client.off?.(Events.ShardReady, queueRecovery);
		await task?.destroy();
		await active?.catch(() => undefined);
	};
}

export { startBirthdayScheduledEvent };
