/**
 * @file transcriptionMessageAccess.ts
 * @description Keeps short-lived Discord channel read permissions in PostgreSQL independently of voice attendance.
 * @module transcriptionMessageAccess
 */

import { ChannelType, Events, PermissionFlagsBits, type Client, type GuildBasedChannel, type GuildMember } from "discord.js";
import type { Pool } from "pg";
import { logData } from "./dataLog.js";

export function canReadMessageChannel(channel: GuildBasedChannel, member: GuildMember): boolean {
	const permissions = channel.permissionsFor(member);
	return Boolean(permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
		&& (channel.type !== ChannelType.PrivateThread || channel.members.cache.has(member.id)
			|| permissions.has(PermissionFlagsBits.ManageThreads)));
}

const changedEvents = [Events.ChannelCreate, Events.ChannelUpdate, Events.ChannelDelete,
	Events.GuildMemberAdd, Events.GuildMemberUpdate, Events.GuildMemberRemove,
	Events.GuildRoleCreate, Events.GuildRoleUpdate, Events.GuildRoleDelete,
	Events.ThreadCreate, Events.ThreadUpdate, Events.ThreadDelete, Events.ThreadMembersUpdate,
	Events.ThreadListSync, Events.GuildUpdate] as const;

export class TranscriptionMessageAccess {
	private generation = 0;
	private hydrated = false;
	private stopped = false;
	private timer?: NodeJS.Timeout;
	private retry?: NodeJS.Timeout;
	private running?: Promise<void>;
	private writes: Promise<unknown> = Promise.resolve();
	private failed = false;
	private lastSuccess = 0;
	private readonly deletedChannels = new Set<string>();

	constructor(private readonly client: Client, private readonly database: Pool, private readonly guildId: string,
		private readonly log: { warn: (message: string) => void; info: (message: string) => void }) {}

	private write<T>(action: () => Promise<T>): Promise<T> {
		const result = this.writes.then(action);
		this.writes = result.catch(() => undefined);
		return result;
	}

	private failure(): void {
		if (!this.failed) logData("Chat visibility permissions could not refresh; stale permissions expire automatically.", { server: this.guildId }, (...args) => this.log.warn(args.join(" ")));
		this.failed = true;
	}

	private readonly changed = (...objects: unknown[]): void => {
		if (this.stopped) return;
		// Discord event signatures differ; invalidate only when the configured guild
		// is present. Global shard events have separate handlers below.
		if (!objects.some((object) => object && typeof object === "object"
			&& ("guild" in object && (object.guild as { id?: string } | undefined)?.id === this.guildId
				|| "id" in object && object.id === this.guildId))) return;
		this.invalidate();
	};

	private readonly channelDeleted = (channel: { id: string; guild?: { id: string } }): void => {
		if (channel.guild?.id !== this.guildId) return;
		this.deletedChannels.add(channel.id);
		this.invalidate();
	};

	private readonly disconnected = (): void => {
		this.hydrated = false;
		this.invalidate();
	};

	private readonly reconnected = (): void => { this.hydrated = false; this.invalidate(); };

	get healthy(): boolean { return !this.failed && this.client.isReady() && Date.now() - this.lastSuccess < 90_000; }

	private invalidate(): void {
		this.generation++;
		void this.write(() => this.database.query("DELETE FROM discord.transcript_channel_access WHERE guild_id=$1", [this.guildId])).catch(() => this.failure());
		if (!this.retry && !this.stopped) {
			this.retry = setTimeout(() => {
				this.retry = undefined;
				void this.sync();
			}, 250);
			this.retry.unref();
		}
	}

	async start(): Promise<void> {
		for (const event of changedEvents) this.client.on(event, this.changed);
		this.client.on(Events.ChannelDelete, this.channelDeleted);
		this.client.on(Events.ThreadDelete, this.channelDeleted);
		this.client.on(Events.ShardDisconnect, this.disconnected);
		this.client.on(Events.ShardResume, this.reconnected);
		this.client.on(Events.ShardReady, this.reconnected);
		this.client.on(Events.GuildUnavailable, this.disconnected);
		this.client.on(Events.GuildDelete, this.disconnected);
		this.client.on(Events.GuildCreate, this.reconnected);
		this.invalidate();
		this.timer = setInterval(() => { void this.sync(); }, 30_000);
		this.timer.unref();
		await this.sync();
	}

	sync(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		if (this.running) return this.running;
		if (this.retry) {
			clearTimeout(this.retry);
			this.retry = undefined;
		}
		const generation = this.generation;
		this.running = this.refresh(generation).catch(() => this.failure()).finally(() => {
			this.running = undefined;
			if (!this.stopped && generation !== this.generation) void this.sync();
		});
		return this.running;
	}

	private async refresh(generation: number): Promise<void> {
		const guild = this.client.guilds.cache.get(this.guildId);
		if (!this.client.isReady() || !guild?.available) return;
		if (!this.hydrated) {
			const members = await guild.members.fetch({ time: 10_000 });
			for (const id of guild.members.cache.keys()) if (!members.has(id)) guild.members.cache.delete(id);
			await guild.roles.fetch();
			const channels = await guild.channels.fetch();
			for (const channel of guild.channels.cache.values()) {
				if (!channel.isThread() && !channels.has(channel.id)) guild.channels.cache.delete(channel.id);
			}
			await guild.channels.fetchActiveThreads();
			if (generation !== this.generation || !this.client.isReady()) return;
		}
		// Include archived threads with saved messages, not just currently active
		// threads in the Gateway cache. An inaccessible/deleted channel fails closed.
		const saved = await this.database.query<{ channel_id: string }>(`SELECT DISTINCT activity_channel_id AS channel_id
			FROM discord.transcript_events WHERE guild_id=$1 AND activity_channel_id IS NOT NULL
			AND event_type IN ('message_posted','message_edited','message_deleted')`, [this.guildId]);
		for (const { channel_id: channelId } of saved.rows) {
			if ((!this.hydrated || !guild.channels.cache.has(channelId)) && !this.deletedChannels.has(channelId)) {
				const channel = await guild.channels.fetch(channelId, { force: true }).catch(() => undefined);
				if (!channel) guild.channels.cache.delete(channelId);
			}
		}
		if (generation !== this.generation || !this.client.isReady()) return;
		this.hydrated = true;
		const me = guild.members.me;
		if (!me) throw new Error("Bot membership unavailable");
		const snapshots: { channel_id: string; user_ids: string[] }[] = [];
		for (const channel of guild.channels.cache.values()) {
			if (!channel.isTextBased() || this.deletedChannels.has(channel.id)
				|| !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) continue;
			if (channel.type === ChannelType.PrivateThread) {
				// Replace stale cache entries as well as adding missing memberships.
				const members = await channel.members.fetch().catch(() => undefined);
				if (!members) continue;
				for (const id of channel.members.cache.keys()) if (!members.has(id)) channel.members.cache.delete(id);
			}
			if (!canReadMessageChannel(channel, me)) continue;
			snapshots.push({ channel_id: channel.id, user_ids: [...guild.members.cache.values()]
				.filter((member) => !member.user.bot && canReadMessageChannel(channel, member)).map((member) => member.id) });
		}
		await this.write(async () => {
			if (this.stopped || generation !== this.generation || !this.client.isReady()) return;
			const connection = await this.database.connect();
			let broken = false;
			try {
				await connection.query("BEGIN");
				await connection.query("DELETE FROM discord.transcript_channel_access WHERE guild_id=$1", [this.guildId]);
				await connection.query(`INSERT INTO discord.transcript_channel_access(guild_id,channel_id,user_ids,valid_until)
					SELECT $1, channel_id, user_ids, statement_timestamp()+interval '90 seconds'
					FROM jsonb_to_recordset($2::jsonb) AS records(channel_id text,user_ids text[])`, [this.guildId, JSON.stringify(snapshots)]);
				await connection.query("COMMIT");
			}
			catch (error) {
				try { await connection.query("ROLLBACK"); }
				catch { broken = true; }
				throw error;
			}
			finally { connection.release(broken); }
		});
		if (this.stopped || generation !== this.generation || !this.client.isReady()) return;
		this.lastSuccess = Date.now();
		if (this.failed) logData("Chat visibility permissions recovered.", { server: this.guildId }, (...args) => this.log.info(args.join(" ")));
		this.failed = false;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.generation++;
		if (this.timer) clearInterval(this.timer);
		if (this.retry) clearTimeout(this.retry);
		for (const event of changedEvents) this.client.off(event, this.changed);
		this.client.off(Events.ChannelDelete, this.channelDeleted);
		this.client.off(Events.ThreadDelete, this.channelDeleted);
		this.client.off(Events.ShardDisconnect, this.disconnected);
		this.client.off(Events.ShardResume, this.reconnected);
		this.client.off(Events.ShardReady, this.reconnected);
		this.client.off(Events.GuildUnavailable, this.disconnected);
		this.client.off(Events.GuildDelete, this.disconnected);
		this.client.off(Events.GuildCreate, this.reconnected);
		await this.running;
		await this.write(() => this.database.query("DELETE FROM discord.transcript_channel_access WHERE guild_id=$1", [this.guildId])).catch(() => this.failure());
	}
}
