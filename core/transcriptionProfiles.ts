/**
 * @file transcriptionProfiles.ts
 * @description Keeps private website profiles current from Discord events and periodic reconciliation.
 * @module transcriptionProfiles
 */
import { join } from "node:path";
import { Events, type Client } from "discord.js";
import { privateJson } from "./transcriptionFiles.js";

export class TranscriptionProfiles {
	private timer?: NodeJS.Timeout;
	private debounce?: NodeJS.Timeout;
	private running?: Promise<void>;
	private stopped = false;
	private snapshot = "";
	private reconciledAt = 0;
	private reconcile = true;
	private readonly changes = [Events.UserUpdate, Events.GuildMemberAdd, Events.GuildMemberUpdate, Events.GuildMemberRemove] as const;
	private readonly reconnects = [Events.ShardReady, Events.ShardResume] as const;
	constructor(private client: Client, private directory: string, private guildId: string, private warn: () => void) {}

	private changed = (): void => {
		if (this.stopped) return;
		clearTimeout(this.debounce);
		this.debounce = setTimeout(() => { void this.refresh(); }, 250);
		this.debounce.unref();
	};
	private reconnected = (): void => {
		this.reconcile = true;
		this.changed();
	};

	async start(): Promise<void> {
		for (const event of this.changes) this.client.on(event, this.changed);
		for (const event of this.reconnects) this.client.on(event, this.reconnected);
		await this.refresh();
		this.timer = setInterval(() => { void this.refresh(); }, 30_000);
		this.timer.unref();
	}

	refresh(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		this.running ??= (async () => {
			const guild = this.client.guilds.cache.get(this.guildId);
			if (!guild) throw new Error("Profile guild unavailable");
			if (this.reconcile || Date.now() - this.reconciledAt >= 300_000) {
				// Events update the cache immediately; reconciliation repairs missed updates.
				try {
					await guild.members.fetch({ time: 10_000 });
					this.reconciledAt = Date.now();
					this.reconcile = false;
				}
				catch { this.warn(); }
			}
			const users: Record<string, { avatarHash: string | null; guildAvatarHash: string | null; displayName: string }> = {};
			for (const member of guild.members.cache.values()) {
				users[member.id] = { avatarHash: member.user.avatar, guildAvatarHash: member.avatar, displayName: member.displayName };
			}
			const snapshot = JSON.stringify(users);
			if (snapshot === this.snapshot || this.stopped) return;
			await privateJson(join(this.directory, "profiles.json"), { version: 1, guildId: this.guildId, users });
			this.snapshot = snapshot;
		})().catch(() => this.warn()).finally(() => { this.running = undefined; });
		return this.running;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		clearInterval(this.timer);
		clearTimeout(this.debounce);
		for (const event of this.changes) this.client.off(event, this.changed);
		for (const event of this.reconnects) this.client.off(event, this.reconnected);
		await this.running;
	}
}
