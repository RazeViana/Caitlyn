/**
 * @file discordLogForwarder.ts
 * @description Forwards selected log levels only to the operator's private main-server channel.
 * Retains definitely-unsent batches, observes late completion, and reports exact bounded loss categories.
 *
 * @module discordLogForwarder
 */

import { stripVTControlCharacters } from "node:util";
import { randomBytes } from "node:crypto";
import { ChannelType, DiscordAPIError, PermissionFlagsBits, type Client, type TextChannel } from "discord.js";
import { subscribeLogs, type LogRecord } from "./logger.js";
import { guildSettings, type GuildLogSettings } from "./guildSettings.js";
import { withTimeout } from "./asyncTools.js";
import { truncate } from "./textLimits.js";
import { validLogTypes } from "./logLevels.js";

export async function logChannel(client: Client, guildId: string, channelId: string): Promise<TextChannel> {
	const guild = client.guilds.cache.get(guildId);
	if (!guild) throw new Error("The bot is not in this server");
	const channel = await guild.channels.fetch(channelId);
	const member = guild.members.me ?? await guild.members.fetchMe();
	if (!channel || channel.guildId !== guildId || channel.type !== ChannelType.GuildText) {
		throw new Error("Choose a text channel in this server");
	}
	if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
		throw new Error("The bot needs View Channel and Send Messages in the selected channel");
	}
	return channel;
}

export function redactLog(text: string, environment: Record<string, string | undefined> = process.env): string {
	let output = stripVTControlCharacters(text);
	const secrets = Object.entries(environment)
		.filter(([key, value]) => /(?:TOKEN|PASSWORD|SECRET|API_KEY)$/.test(key) && value)
		.map(([, value]) => value!).sort((a, b) => b.length - a.length);
	for (const secret of secrets) {
		output = output.replaceAll(secret, "[REDACTED]");
		output = output.replaceAll(encodeURIComponent(secret), "[REDACTED]");
	}
	return output.replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]")
		.replace(/((?:postgres(?:ql)?|https?):\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[REDACTED]@");
}

type DeliveryDisposition = "retryable" | "failed" | "uncertain";

/** Only use retryable when no message-creation request was accepted or its rejection is definitive. */
export class LogDeliveryFailure extends Error {
	constructor(readonly disposition: DeliveryDisposition) {
		super(`log_delivery_${disposition}`);
	}
}

interface Losses {
	overflow: number;
	failed: number;
	uncertain: number;
}

interface Batch {
	content: string;
	chunks: number;
	nonce: string;
	attempts: number;
	created: number;
	notices: Losses;
}

interface Destination {
	settings: GuildLogSettings;
	queue: string[];
	losses: Losses;
	batch?: Batch;
	blockedUntil: number;
	sending: boolean;
}

export interface ForwarderDependencies {
	settings: Pick<typeof guildSettings, "list">;
	subscribe: typeof subscribeLogs;
	now: () => number;
	send: (settings: GuildLogSettings, content: string, nonce: string) => Promise<unknown>;
	diagnostic: (message: string) => void;
	deliveryTimeoutMs: number;
}

const emptyLosses = (): Losses => ({ overflow: 0, failed: 0, uncertain: 0 });
const MAX_ATTEMPTS = 5;
const BATCH_LIFETIME = 15 * 60_000;

export function createDiscordLogForwarder(client: Client, overrides: Partial<ForwarderDependencies> = {}) {
	const dependencies: ForwarderDependencies = {
		settings: guildSettings,
		subscribe: subscribeLogs,
		now: Date.now,
		send: async (settings, content, nonce) => {
			let channel: TextChannel;
			try {
				channel = await logChannel(client, settings.guild_id, settings.log_channel_id!);
				if (destinations.get(settings.guild_id)?.settings !== settings) return;
				if (channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) !== false) throw new Error("private_destination_required");
			}
			catch {
				// Only reads happened: retrying this batch cannot duplicate a message.
				throw new LogDeliveryFailure("retryable");
			}
			try {
				await channel.send({ content, nonce, enforceNonce: true, allowedMentions: { parse: [] }, flags: ["SuppressEmbeds"] });
			}
			catch (error) {
				// Network/5xx failures after POST may have been accepted. Never infer non-delivery from them.
				if (error instanceof DiscordAPIError && error.status >= 400 && error.status < 500 && error.status !== 408) {
					throw new LogDeliveryFailure(error.status === 429 ? "retryable" : "failed");
				}
				throw new LogDeliveryFailure("uncertain");
			}
		},
		// Never feed transport failures back into the logger's subscription.
		diagnostic: (message) => console.warn(`[Discord logs] ${message}`),
		deliveryTimeoutMs: 10_000,
		...overrides,
	};
	const destinations = new Map<string, Destination>();
	const startup: LogRecord[] = [];
	let initialized = false;
	let stopped = false;
	let revision = 0;
	let refreshing = false;
	let flushTimer: ReturnType<typeof setInterval> | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let activeFlush: Promise<void> | undefined;
	let starting: Promise<void> | undefined;

	function update(settings: GuildLogSettings): void {
		revision++;
		if (settings.log_scope !== "console") return;
		const existing = destinations.get(settings.guild_id);
		if (existing?.settings.log_channel_id === settings.log_channel_id
			&& JSON.stringify(existing.settings.log_levels) === JSON.stringify(settings.log_levels)) return;
		destinations.clear();
		if (settings.log_channel_id !== null && validLogTypes(settings.log_levels)) {
			destinations.set(settings.guild_id, { settings: { ...settings, log_levels: [...settings.log_levels] }, queue: [], losses: emptyLosses(), blockedUntil: 0, sending: false });
		}
	}

	function queueChunk(destination: Destination, chunk: string): void {
		if (destination.queue.length >= 200) {
			destination.queue.shift();
			destination.losses.overflow++;
		}
		destination.queue.push(chunk);
	}

	function enqueue(record: LogRecord): void {
		for (const destination of destinations.values()) {
			if (!destination.settings.log_levels.includes(record.level)) continue;
			const text = `${record.timestamp} [${record.level}] ${record.message}`.replaceAll("`", "ˋ");
			let remaining = text;
			while (remaining.length) {
				let end = Math.min(1800, remaining.length);
				if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
				queueChunk(destination, remaining.slice(0, end));
				remaining = remaining.slice(end);
			}
		}
	}

	const unsubscribe = dependencies.subscribe((record) => {
		if (stopped) return;
		const safe = { ...record, message: truncate(redactLog(record.message), 16_000) };
		if (!initialized) {
			if (startup.length === 100) startup.shift();
			startup.push(safe);
		}
		else {
			enqueue(safe);
		}
	});

	async function refresh(): Promise<void> {
		if (stopped || refreshing) return;
		refreshing = true;
		const before = revision;
		try {
			const settings = (await dependencies.settings.list()).filter((row) => row.log_scope === "console");
			if (stopped || before !== revision) return;
			if (settings.length > 1) {
				destinations.clear();
				dependencies.diagnostic("More than one server is set up for private logs; sending logs to Discord is paused. Check database setup step 012.");
				return;
			}
			for (const id of destinations.keys()) {
				if (!settings.some((row) => row.guild_id === id)) destinations.delete(id);
			}
			for (const row of settings) update(row);
			if (!initialized) {
				initialized = true;
				for (const record of startup.splice(0)) enqueue(record);
			}
		}
		catch {
			dependencies.diagnostic("Could not load the Discord log settings; logs still appear in the console. Check the database connection and setup steps 011/012.");
		}
		finally {
			refreshing = false;
		}
	}

	function takeBatch(destination: Destination): Batch | undefined {
		const notices = destination.settings.log_levels.includes("WARN") ? destination.losses : emptyLosses();
		destination.losses = emptyLosses();
		let content = [
			notices.overflow ? `[WARN] Too many logs were waiting to be sent; dropped parts of the log: ${notices.overflow}.` : "",
			notices.failed ? `[WARN] Could not send parts of the log: ${notices.failed}. No more attempts will be made for these parts.` : "",
			notices.uncertain ? `[WARN] Could not confirm whether parts of the log were sent: ${notices.uncertain}. They will not be sent again, to avoid duplicates.` : "",
		].filter(Boolean).join("\n");
		if (content) content += "\n";
		let chunks = 0;
		while (destination.queue.length && content.length + destination.queue[0].length + 1 <= 1900) {
			content += destination.queue.shift() + "\n";
			chunks++;
		}
		if (!content) return;
		return { content: `\`\`\`text\n${content}\`\`\``, chunks, notices, nonce: randomBytes(12).toString("hex"), attempts: 0, created: dependencies.now() };
	}

	function retire(destination: Destination, batch: Batch, disposition: "failed" | "uncertain"): void {
		// Preserve undelivered notices too; their counts are not themselves queued log chunks.
		for (const kind of ["overflow", "failed", "uncertain"] as const) destination.losses[kind] += batch.notices[kind];
		destination.losses[disposition] += batch.chunks;
		destination.batch = undefined;
	}

	async function deliver(destination: Destination): Promise<void> {
		if (destination.sending || destination.blockedUntil > dependencies.now()) return;
		const batch = destination.batch ?? takeBatch(destination);
		if (!batch) return;
		destination.batch = batch;
		if (batch.attempts && dependencies.now() - batch.created >= BATCH_LIFETIME) {
			retire(destination, batch, "failed");
			dependencies.diagnostic(`Stopped trying to send these logs after 15 minutes; parts of the log not sent: ${batch.chunks}.`);
			return;
		}
		batch.attempts++;
		destination.sending = true;
		let settled = false;
		let delayed = false;
		const current = (): boolean => destinations.get(destination.settings.guild_id) === destination && destination.batch === batch;
		// Observe the ORIGINAL promise, not just the deadline race. A late success is still success.
		const sending = Promise.resolve().then(() => dependencies.send(destination.settings, batch.content, batch.nonce)).then(() => {
			settled = true;
			if (!current()) return;
			destination.sending = false;
			destination.batch = undefined;
			if (batch.attempts > 1 || delayed) {
				const message = `Discord confirmed the logs were sent; attempts: ${batch.attempts}, time waiting: ${Math.max(0, dependencies.now() - batch.created)} ms.`;
				dependencies.diagnostic(message);
				if (destination.settings.log_levels.includes("SUCCESS")) queueChunk(destination, `[SUCCESS] ${message}`);
			}
		}, (error: unknown) => {
			settled = true;
			if (!current()) return;
			destination.sending = false;
			const disposition = error instanceof LogDeliveryFailure ? error.disposition : "uncertain";
			const retry = disposition === "retryable" && batch.attempts < MAX_ATTEMPTS && dependencies.now() - batch.created < BATCH_LIFETIME;
			const delay = retry ? Math.min(300_000, 30_000 * 2 ** (batch.attempts - 1)) : 30_000;
			destination.blockedUntil = dependencies.now() + delay;
			if (retry) {
				dependencies.diagnostic(`These logs were not sent; keeping them for another try in ${delay / 1000} seconds. Next attempt: ${batch.attempts + 1}/${MAX_ATTEMPTS}; parts of the log waiting: ${batch.chunks}.`);
			}
			else {
				retire(destination, batch, disposition === "uncertain" ? "uncertain" : "failed");
				const message = disposition === "uncertain"
					? "Could not confirm whether these logs were sent; they will not be sent again, to avoid duplicates"
					: "Could not send these logs; no more attempts will be made for these parts";
				dependencies.diagnostic(`${message}. Parts of the log affected: ${batch.chunks}. Logs still appear in the console.`);
			}
		});
		try {
			await withTimeout(sending, dependencies.deliveryTimeoutMs, "Discord log delivery");
		}
		catch {
			if (!settled && current()) {
				delayed = true;
				dependencies.diagnostic(`Discord is taking longer to confirm the send; still waiting, without sending another copy. Parts of the log waiting: ${batch.chunks}. Logs still appear in the console.`);
			}
		}
	}

	function flush(): Promise<void> {
		if (activeFlush) return activeFlush;
		activeFlush = (async () => {
			if (!client.isReady()) return;
			await Promise.all([...destinations.values()].map(deliver));
		})().finally(() => { activeFlush = undefined; });
		return activeFlush;
	}

	return {
		update(settings: GuildLogSettings): void {
			if (stopped) return;
			update(settings);
			if (!initialized) {
				initialized = true;
				for (const record of startup.splice(0)) enqueue(record);
			}
		},
		refresh,
		flush,
		start(): Promise<void> {
			starting ??= (async () => {
				if (stopped) return;
				await refresh();
				if (stopped) return;
				flushTimer = setInterval(() => { void flush(); }, 2000);
				refreshTimer = setInterval(() => { void refresh(); }, 60_000);
				flushTimer.unref();
				refreshTimer.unref();
			})();
			return starting;
		},
		async stop(): Promise<void> {
			if (stopped) return;
			stopped = true;
			unsubscribe();
			clearInterval(flushTimer);
			clearInterval(refreshTimer);
			try {
				await flush();
			}
			finally {
				destinations.clear();
				startup.length = 0;
			}
		},
	};
}

export type DiscordLogForwarder = ReturnType<typeof createDiscordLogForwarder>;
export const logForwarders = new WeakMap<Client, DiscordLogForwarder>();
