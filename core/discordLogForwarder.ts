/**
 * @file discordLogForwarder.ts
 * @description Forwards selected log levels only to the operator's private main-server channel.
 * Ignores legacy server destinations, redacts credentials, and bounds delivery queues.
 *
 * @module discordLogForwarder
 */

import { stripVTControlCharacters } from "node:util";
import { ChannelType, PermissionFlagsBits, type Client, type TextChannel } from "discord.js";
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

interface Destination {
	settings: GuildLogSettings;
	queue: string[];
	dropped: number;
	blockedUntil: number;
	sending: boolean;
}

export interface ForwarderDependencies {
	settings: Pick<typeof guildSettings, "list">;
	subscribe: typeof subscribeLogs;
	now: () => number;
	send: (settings: GuildLogSettings, content: string) => Promise<unknown>;
	diagnostic: (message: string) => void;
}

export function createDiscordLogForwarder(client: Client, overrides: Partial<ForwarderDependencies> = {}) {
	const dependencies: ForwarderDependencies = {
		settings: guildSettings,
		subscribe: subscribeLogs,
		now: Date.now,
		send: async (settings, content) => {
			const destination = destinations.get(settings.guild_id);
			const channel = await logChannel(client, settings.guild_id, settings.log_channel_id!);
			if (!destination || destinations.get(settings.guild_id) !== destination) return;
			if (channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) !== false) {
				throw new Error("The console destination must remain private");
			}
			await channel.send({ content, allowedMentions: { parse: [] }, flags: ["SuppressEmbeds"] });
		},
		// Never feed transport failures back into the logger's subscription.
		diagnostic: (message) => console.warn(`[Discord logs] ${message}`),
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
			destinations.set(settings.guild_id, { settings: { ...settings, log_levels: [...settings.log_levels] }, queue: [], dropped: 0, blockedUntil: 0, sending: false });
		}
	}

	function enqueue(record: LogRecord): void {
		for (const destination of destinations.values()) {
			if (!destination.settings.log_levels.includes(record.level)) continue;
			const text = `${record.timestamp} [${record.level}] ${record.message}`.replaceAll("`", "ˋ");
			let remaining = text;
			while (remaining.length) {
				let end = Math.min(1800, remaining.length);
				if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
				if (destination.queue.length >= 200) {
					destination.queue.shift();
					destination.dropped++;
				}
				destination.queue.push(remaining.slice(0, end));
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
				dependencies.diagnostic("Multiple main logging servers found; forwarding is paused. Check migration 012.");
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
			dependencies.diagnostic("Could not load configuration; console logging continues. Check PostgreSQL and migrations 011/012.");
		}
		finally {
			refreshing = false;
		}
	}

	function flush(): Promise<void> {
		if (activeFlush) return activeFlush;
		activeFlush = (async () => {
			if (!client.isReady()) return;
			await Promise.all([...destinations.values()].map(async (destination) => {
				if (destination.sending || destination.blockedUntil > dependencies.now()) return;
				if (!destination.queue.length && !destination.dropped) return;
				let content = destination.dropped && destination.settings.log_levels.includes("WARN")
					? `[WARN] ${destination.dropped} log chunks omitted during congestion or failed delivery.\n` : "";
				destination.dropped = 0;
				while (destination.queue.length && content.length + destination.queue[0].length + 1 <= 1900) {
					content += destination.queue.shift() + "\n";
				}
				if (!content) return;
				destination.sending = true;
				const sending = Promise.resolve().then(() => dependencies.send(destination.settings, `\`\`\`text\n${content}\`\`\``));
				const release = (): void => { destination.sending = false; };
				void sending.then(release, release);
				try {
					await withTimeout(sending, 10_000, "Discord log delivery");
				}
				catch {
					destination.dropped++;
					destination.blockedUntil = dependencies.now() + 30_000;
					dependencies.diagnostic("Delivery failed; cooling down this destination for 30 seconds. Console logging continues.");
				}
			}));
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
