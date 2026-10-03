/**
 * @file transcriptionRuntime.ts
 * @description Captures username-attributed speech and activity with membership-boundary audiences and optional PostgreSQL replay.
 * @module transcriptionRuntime
 */

import { randomUUID } from "node:crypto";
import { ChannelType, Events, PermissionFlagsBits, type Client, type GuildMember, type Message, type VoiceChannel, type VoiceState } from "discord.js";
import { SpeakerBuffer, localTranscriber } from "./transcriptionAudio.js";
import { transcriptionSettings, type TranscriptionConfig } from "./transcriptionConfig.js";
import { TranscriptionQueue } from "./transcriptionQueue.js";
import { TranscriptionStore, type TranscriptRecord } from "./transcriptionStore.js";
import { connectTranscriptionVoice, type VoiceCapture } from "./transcriptionVoice.js";
import logger from "./logger.js";
import { pool } from "./createPGPool.js";
import { TranscriptionArchive } from "./transcriptionArchive.js";

interface Session {
	id: string;
	channel: VoiceChannel;
	capture: VoiceCapture;
	speakers: Map<string, { name: string; joinedAt: number; buffer: SpeakerBuffer }>;
	ready: boolean;
	sharingSafe: boolean;
	messageIds: Set<string>;
	startedAt: number;
}

export interface TranscriptionDependencies {
	archive?: TranscriptionArchive;
	store: TranscriptionStore;
	connect: typeof connectTranscriptionVoice;
	transcribe: (pcm: Buffer, signal: AbortSignal) => Promise<string>;
	now: () => number;
	log: Pick<typeof logger, "warn" | "info">;
}

export class TranscriptionRuntime {
	private session?: Session;
	private paused = false;
	private stopping = false;
	private timer?: NodeJS.Timeout;
	private serial: Promise<unknown> = Promise.resolve();
	private reconciling?: Promise<void>;
	private retryAt = 0;
	private preferred?: string;
	private readonly pendingJoins = new Map<string, { channelId: string; at: number }>();
	private readonly dependencies: TranscriptionDependencies;
	private readonly queue: TranscriptionQueue;

	constructor(readonly client: Client, readonly config: TranscriptionConfig, dependencies: Partial<TranscriptionDependencies> = {}) {
		this.dependencies = { store: new TranscriptionStore(config.directory, config.timezone), connect: connectTranscriptionVoice,
			transcribe: localTranscriber(config), now: Date.now, log: logger, ...dependencies };
		this.queue = new TranscriptionQueue(this.dependencies.transcribe, (record) => this.dependencies.store.append(record), () => {
			this.paused = true;
			this.dependencies.log.warn("Voice transcription paused: cannot save daily logs; no conversation content logged.");
			void this.serialize(() => this.closeSession("Storage unavailable; recording stopped."));
		});
	}

	private serialize<T>(action: () => Promise<T>): Promise<T> {
		const result = this.serial.then(action);
		this.serial = result.catch(() => undefined);
		return result;
	}

	private readonly voiceChanged = (before: VoiceState, after: VoiceState): void => {
		if (after.guild.id !== this.config.guildId) return;
		const session = this.session;
		const member = after.member ?? before.member;
		if (!this.paused && !this.stopping && member && !member.user.bot) {
			const at = this.dependencies.now();
			if (before.channelId !== after.channelId) {
				this.pendingJoins.delete(member.id);
				if (!session && after.channel?.type === ChannelType.GuildVoice && this.allowed(after.channel)) {
					this.pendingJoins.set(member.id, { channelId: after.channel.id, at });
				}
				if (session) {
					if (before.channelId === session.channel.id) {
						this.removeSpeaker(session, member.id, at, after.channel ? `Moved to "${after.channel.name}" (${after.channel.id}).` : undefined);
					}
					if (after.channelId === session.channel.id) {
						this.addSpeaker(session, member, "joined", at, before.channel ? `Moved from "${before.channel.name}" (${before.channel.id}).` : undefined);
					}
					session.capture.sync([...session.speakers.keys()]);
				}
			}
			else if (session && after.channelId === session.channel.id && session.speakers.has(member.id)) {
				const changes: string[] = [];
				const settings = [
					["selfMute", "Microphone muted", "Microphone unmuted"],
					["selfDeaf", "Audio deafened", "Audio undeafened"],
					["serverMute", "Server muted", "Server unmuted"],
					["serverDeaf", "Server deafened", "Server undeafened"],
					["streaming", "Screen sharing started", "Screen sharing stopped"],
					["selfVideo", "Camera turned on", "Camera turned off"],
				] as const;
				for (const [setting, enabled, disabled] of settings) {
					if (typeof before[setting] === "boolean" && typeof after[setting] === "boolean" && before[setting] !== after[setting]) changes.push(after[setting] ? enabled : disabled);
				}
				if (changes.length) {
					void this.queue.write(this.record(session, "voice_activity", {
						at: new Date(at).toISOString(), userId: member.id, speaker: member.user.username, text: `${changes.join("; ")}.`,
					}));
				}
			}
		}
		if (after.id === this.client.user?.id && this.session && (after.channelId !== this.session.channel.id || after.serverDeaf)) {
			this.connectionFailed(this.session);
		}
		void this.reconcile().catch(() => this.dependencies.log.warn("Voice transcription channel update failed; will retry."));
	};

	private readonly messageCreated = (message: Message): void => {
		const session = this.session;
		const speaker = session?.speakers.get(message.author.id);
		if (!session || this.paused || this.stopping || !this.queue.healthy || !message.inGuild()
			|| message.guildId !== this.config.guildId || message.author.bot || message.webhookId || message.system
			|| !speaker || !session.channel.members.has(message.author.id)
			|| message.createdTimestamp < Math.max(session.startedAt, speaker.joinedAt)
			|| session.messageIds.has(message.id)) return;
		session.messageIds.add(message.id);
		if (session.messageIds.size > 2048) session.messageIds.delete(session.messageIds.values().next().value!);
		const parent = message.channel.isThread() ? message.channel.parent : null;
		const record = this.record(session, "message_posted", {
			at: new Date(message.createdTimestamp).toISOString(), userId: message.author.id, speaker: message.author.username,
			activityChannelId: message.channelId, activityChannelName: message.channel.name,
			activityParentChannelId: parent?.id, activityParentChannelName: parent?.name,
			messageId: message.id, messageUrl: message.url, text: message.content,
			attachmentNames: [...message.attachments.values()].map((attachment) => attachment.name),
		});
		record.audienceUserIds = record.audienceUserIds!.filter((id) => {
			const member = session.channel.members.get(id);
			if (!member) return false;
			const permissions = message.channel.permissionsFor?.(member);
			if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) return false;
			return message.channel.type !== ChannelType.PrivateThread || message.channel.members.cache.has(id)
				|| permissions.has(PermissionFlagsBits.ManageThreads);
		});
		void this.queue.write(record);
	};

	private readonly gatewayLost = (): void => {
		if (this.session) this.connectionFailed(this.session);
	};

	async start(): Promise<void> {
		await this.dependencies.store.initialize();
		this.dependencies.archive?.start();
		this.paused = await this.dependencies.store.paused();
		this.client.on(Events.VoiceStateUpdate, this.voiceChanged);
		this.client.on(Events.MessageCreate, this.messageCreated);
		this.client.on(Events.ShardDisconnect, this.gatewayLost);
		this.timer = setInterval(() => {
			for (const speaker of this.session?.speakers.values() ?? []) speaker.buffer.idle(this.dependencies.now());
			void this.reconcile().catch(() => this.dependencies.log.warn("Voice transcription reconciliation failed; will retry."));
		}, 1000);
		this.timer.unref();
		await this.reconcile();
	}

	private humans(channel: VoiceChannel) { return [...channel.members.values()].filter((member) => !member.user.bot); }
	private allowed(channel: VoiceChannel): boolean { return this.config.channels.includes("*") || this.config.channels.includes(channel.id); }

	private record(session: Session, type: TranscriptRecord["type"], fields: Partial<TranscriptRecord> = {}): TranscriptRecord {
		const at = fields.at ?? new Date(this.dependencies.now()).toISOString();
		const audience = session.sharingSafe && this.client.isReady()
			? [...session.speakers].filter(([, speaker]) => speaker.joinedAt <= Date.parse(at)).map(([id]) => id) : [];
		return { eventId: randomUUID(), type, at, guildId: this.config.guildId,
			channelId: session.channel.id, channelName: session.channel.name, sessionId: session.id,
			audienceVersion: 1, audienceUserIds: audience, ...fields };
	}

	private flushSpeakers(session: Session): void {
		for (const speaker of session.speakers.values()) speaker.buffer.flush();
	}

	private addSpeaker(session: Session, member: GuildMember, type: "joined" | "present", at: number, reason?: string): void {
		const existing = session.speakers.get(member.id);
		if (existing) {
			existing.name = member.user.username;
			return;
		}
		// Flush before changing membership. Inference keeps this immutable audience even if it finishes later.
		this.flushSpeakers(session);
		const speaker = { name: member.user.username, joinedAt: at, buffer: new SpeakerBuffer(this.config.timezone, (chunk) => {
			this.queue.push(chunk, this.record(session, "transcript", { at: new Date(chunk.at).toISOString(), end: new Date(chunk.end).toISOString(),
				userId: member.id, speaker: speaker.name }));
		}) };
		session.speakers.set(member.id, speaker);
		void this.queue.write(this.record(session, type, { at: new Date(at).toISOString(), userId: member.id, speaker: speaker.name, text: reason }));
	}

	private removeSpeaker(session: Session, userId: string, at: number, reason?: string, verified = true): void {
		const speaker = session.speakers.get(userId);
		if (!speaker) return;
		this.flushSpeakers(session);
		void this.queue.write(this.record(session, "left", { at: new Date(at).toISOString(), userId, speaker: speaker.name, text: reason,
			...(verified ? {} : { audienceUserIds: [] }),
		}));
		session.speakers.delete(userId);
	}

	private syncSpeakers(session: Session): void {
		const members = this.humans(session.channel);
		const changed = [...session.speakers.keys()].some((id) => !members.some((member) => member.id === id))
			|| members.some((member) => !session.speakers.has(member.id));
		if (changed) {
			// A cache correction cannot establish the exact boundary: buffered speech stays operator-only.
			session.sharingSafe = false;
			this.flushSpeakers(session);
			session.sharingSafe = this.client.isReady();
		}
		for (const id of session.speakers.keys()) {
			if (!members.some((member) => member.id === id)) this.removeSpeaker(session, id, this.dependencies.now(), "Membership reconciled; the exact departure time is unavailable.", false);
		}
		for (const member of members) {
			const arrival = this.pendingJoins.get(member.id);
			const joined = arrival?.channelId === session.channel.id;
			this.addSpeaker(session, member, joined ? "joined" : "present", joined ? arrival.at : this.dependencies.now());
			this.pendingJoins.delete(member.id);
		}
		session.capture.sync([...session.speakers.keys()]);
	}

	private connectionFailed(session: Session): void {
		if (this.session !== session) return;
		session.sharingSafe = false;
		this.retryAt = this.dependencies.now() + 15_000;
		// Stop packet receipt now; the serialized cleanup also writes the failure interval.
		session.capture.close();
		void this.serialize(async () => {
			if (this.session !== session) return;
			await this.queue.write(this.record(session, "gap", { text: "Voice connection lost; reconnecting after a short delay. Audio during the interruption is unavailable." }));
			await this.closeSession("Voice connection lost.");
		});
	}

	reconcile(): Promise<void> {
		if (this.reconciling) return this.reconciling;
		this.reconciling = this.serialize(async () => {
			if (this.stopping || this.paused) return;
			const guild = this.client.guilds.cache.get(this.config.guildId);
			if (!guild || !this.client.isReady()) {
				if (this.session) this.connectionFailed(this.session);
				return;
			}
			if (this.session) {
				this.syncSpeakers(this.session);
				if (this.humans(this.session.channel).length) {
					return;
				}
				await this.closeSession("Voice channel is empty.");
				this.preferred = undefined;
			}
			if (this.dependencies.now() < this.retryAt) return;
			const channels = [...guild.channels.cache.values()].filter((channel): channel is VoiceChannel => channel.type === ChannelType.GuildVoice && this.allowed(channel) && this.humans(channel).length > 0);
			channels.sort((a, b) => Number(b.id === this.preferred) - Number(a.id === this.preferred) || a.rawPosition - b.rawPosition || a.id.localeCompare(b.id));
			for (const channel of channels) {
				const permissions = channel.permissionsFor(this.client.user!);
				if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.SendMessages])) continue;
				this.retryAt = this.dependencies.now() + 15_000;
				let session: Session | undefined;
				try {
					const capture = this.dependencies.connect(channel, (userId, pcm, at) => {
						if (!session || this.session !== session || this.paused || this.stopping) return;
						if (!this.client.isReady()) {
							this.connectionFailed(session);
							return;
						}
						session.speakers.get(userId)?.buffer.push(pcm, at);
					}, () => { if (session) this.connectionFailed(session); });
					session = { id: randomUUID(), channel, capture, speakers: new Map(), ready: false, sharingSafe: true, messageIds: new Set(), startedAt: this.dependencies.now() };
					this.session = session;
					// Install listeners before awaiting the voice handshake so the first speech is captured.
					this.syncSpeakers(session);
					this.pendingJoins.clear();
					void capture.ready.then(async () => {
						if (this.session !== session || this.stopping) return;
						session!.ready = true;
						await this.queue.write(this.record(session!, "session_started", { text: "Local voice transcription started. Raw audio is not saved." }));
						if (this.session !== session || this.stopping || this.paused) return;
						await channel.send({ content: "🎙️ Caitlyn is transcribing this voice channel. Private daily logs on Mainframe include speech, voice activity, and participants' posts in channels Caitlyn can see, including message text and links. Discord usernames identify participants. Raw audio is not saved. An administrator can use `/transcribe stop` to stop recording and activity logging.", allowedMentions: { parse: [] } });
					}).catch(() => { if (session) this.connectionFailed(session); });
					break;
				}
				catch {
					if (session) await this.closeSession("Could not start voice reception.");
					this.dependencies.log.warn("Could not join voice for local transcription; will retry.");
				}
			}
		}).finally(() => { this.reconciling = undefined; });
		return this.reconciling;
	}

	private async closeSession(reason: string): Promise<void> {
		const session = this.session;
		if (!session) return;
		this.session = undefined;
		session.capture.close();
		for (const speaker of session.speakers.values()) speaker.buffer.flush();
		await this.queue.write(this.record(session, "session_stopped", { text: reason }));
	}

	status(): string {
		const state = this.paused ? "paused" : this.session ? `${this.session.ready ? "recording" : "connecting to"} <#${this.session.channel.id}>` : "waiting for an occupied voice channel";
		return [
			`**Status:** ${state}`,
			`**Automatic recording:** ${this.paused ? "paused until resumed" : "enabled"}`,
			"",
			"**Speech processing**",
			`Pending segments: **${this.queue.pending}**`,
			`Failed or dropped segments: **${this.queue.lost}** (since bot startup)`,
			"",
			"**Daily logs**",
			`Timezone: **${this.config.timezone}**`,
			this.dependencies.archive ? `**Database archive:** ${this.dependencies.archive.status()}` : "**Database archive:** disabled",
			"Speech recognition runs locally. Logs stay private on **Mainframe**.",
			"Includes voice joins/leaves, voice activity, and participants' message text and links.",
			"",
			this.paused
				? "Use `/transcribe resume` to resume automatic recording, or `/transcribe start` to select your voice channel."
				: "Use `/transcribe stop` to pause recording. The pause is saved across restarts.",
		].join("\n");
	}

	async pause(): Promise<void> {
		await this.serialize(async () => {
			this.paused = true;
			this.pendingJoins.clear();
			await this.closeSession("Stopped by an administrator.");
			await this.dependencies.store.setPaused(true);
		});
	}

	async resume(channelId?: string): Promise<void> {
		await this.serialize(async () => {
			if (!this.queue.healthy) throw new Error("Log storage failed; repair the directory and restart Caitlyn.");
			if (channelId && this.session && channelId !== this.session.channel.id) throw new Error("Already recording another channel; stop it first.");
			if (channelId && !this.config.channels.includes("*") && !this.config.channels.includes(channelId)) throw new Error("This channel is not enabled by the operator.");
			await this.dependencies.store.setPaused(false);
			this.paused = false;
			this.preferred = channelId;
			this.retryAt = 0;
		});
		await this.reconcile();
	}

	async stop(): Promise<void> {
		this.stopping = true;
		if (this.timer) clearInterval(this.timer);
		this.client.off(Events.VoiceStateUpdate, this.voiceChanged);
		this.client.off(Events.MessageCreate, this.messageCreated);
		this.client.off(Events.ShardDisconnect, this.gatewayLost);
		await this.serialize(() => this.closeSession("Caitlyn is shutting down."));
		await this.queue.stop();
		await this.dependencies.store.drain();
		await this.dependencies.archive?.stop();
	}
}

export const transcriptionRuntimes = new WeakMap<Client, TranscriptionRuntime>();

export function configuredTranscriptionRuntime(client: Client): TranscriptionRuntime | undefined {
	const settings = transcriptionSettings();
	if (!settings.enabled) return undefined;
	const archive = settings.config.databaseEnabled
		? new TranscriptionArchive(pool, settings.config.directory, settings.config.guildId, logger) : undefined;
	return new TranscriptionRuntime(client, settings.config, { archive });
}
