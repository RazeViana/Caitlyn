/**
 * @file transcriptionRuntime.ts
 * @description Automatically follows occupied voice channels and persists speaker-attributed daily conversations.
 * @module transcriptionRuntime
 */

import { randomUUID } from "node:crypto";
import { ChannelType, Events, PermissionFlagsBits, type Client, type VoiceChannel, type VoiceState } from "discord.js";
import { SpeakerBuffer, localTranscriber } from "./transcriptionAudio.js";
import { transcriptionSettings, type TranscriptionConfig } from "./transcriptionConfig.js";
import { TranscriptionQueue } from "./transcriptionQueue.js";
import { TranscriptionStore, type TranscriptRecord } from "./transcriptionStore.js";
import { connectTranscriptionVoice, type VoiceCapture } from "./transcriptionVoice.js";
import logger from "./logger.js";

interface Session {
	id: string;
	channel: VoiceChannel;
	capture: VoiceCapture;
	speakers: Map<string, { name: string; buffer: SpeakerBuffer }>;
	ready: boolean;
}

export interface TranscriptionDependencies {
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
		// Flush departing speakers immediately, before a queued channel reconciliation.
		if (before.channelId !== after.channelId && this.session?.channel.id === before.channelId) {
			this.session.speakers.get(after.id)?.buffer.flush();
		}
		if (after.id === this.client.user?.id && this.session && (after.channelId !== this.session.channel.id || after.serverDeaf)) {
			this.connectionFailed(this.session);
		}
		void this.reconcile().catch(() => this.dependencies.log.warn("Voice transcription channel update failed; will retry."));
	};

	async start(): Promise<void> {
		await this.dependencies.store.initialize();
		this.paused = await this.dependencies.store.paused();
		this.client.on(Events.VoiceStateUpdate, this.voiceChanged);
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
		return { type, at: new Date(this.dependencies.now()).toISOString(), guildId: this.config.guildId,
			channelId: session.channel.id, channelName: session.channel.name, sessionId: session.id, ...fields };
	}

	private syncSpeakers(session: Session): void {
		const members = this.humans(session.channel);
		for (const [id, speaker] of session.speakers) {
			if (members.some((member) => member.id === id)) continue;
			speaker.buffer.flush();
			session.speakers.delete(id);
			void this.queue.write(this.record(session, "left", { userId: id, speaker: speaker.name }));
		}
		for (const member of members) {
			if (session.speakers.has(member.id)) {
				session.speakers.get(member.id)!.name = member.displayName;
				continue;
			}
			const speaker = { name: member.displayName, buffer: new SpeakerBuffer(this.config.timezone, (chunk) => {
				this.queue.push(chunk, this.record(session, "transcript", { at: new Date(chunk.at).toISOString(), end: new Date(chunk.end).toISOString(),
					userId: member.id, speaker: speaker.name }));
			}) };
			session.speakers.set(member.id, speaker);
			void this.queue.write(this.record(session, "joined", { userId: member.id, speaker: speaker.name }));
		}
		session.capture.sync([...session.speakers.keys()]);
	}

	private connectionFailed(session: Session): void {
		if (this.session !== session) return;
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
			if (!guild || !this.client.isReady()) return;
			if (this.session) {
				if (this.humans(this.session.channel).length) {
					this.syncSpeakers(this.session);
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
						if (session && this.session === session && !this.paused && !this.stopping) session.speakers.get(userId)?.buffer.push(pcm, at);
					}, () => { if (session) this.connectionFailed(session); });
					session = { id: randomUUID(), channel, capture, speakers: new Map(), ready: false };
					this.session = session;
					// Install listeners before awaiting the voice handshake so the first speech is captured.
					this.syncSpeakers(session);
					void capture.ready.then(async () => {
						if (this.session !== session || this.stopping) return;
						session!.ready = true;
						await this.queue.write(this.record(session!, "session_started", { text: "Local voice transcription started. Raw audio is not saved." }));
						if (this.session !== session || this.stopping || this.paused) return;
						await channel.send({ content: "🎙️ Caitlyn is transcribing this voice channel. Speaker-labelled daily logs are saved privately on Mainframe using a local speech model. Raw audio is not saved. An administrator can use `/transcribe stop` to stop recording.", allowedMentions: { parse: [] } });
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
		for (const [userId, speaker] of session.speakers) {
			speaker.buffer.flush();
			await this.queue.write(this.record(session, "left", { userId, speaker: speaker.name, text: reason }));
		}
		await this.queue.write(this.record(session, "session_stopped", { text: reason }));
	}

	status(): string {
		const state = this.paused ? "paused" : this.session ? `${this.session.ready ? "recording" : "connecting to"} <#${this.session.channel.id}>` : "waiting for an occupied voice channel";
		return `Voice transcription: ${state}. Pending speech chunks: ${this.queue.pending}. Failed or dropped chunks since startup: ${this.queue.lost}. Daily logs use ${this.config.timezone}. One voice channel can be recorded at a time. Logs and speech recognition stay on Mainframe.`;
	}

	async pause(): Promise<void> {
		await this.serialize(async () => {
			this.paused = true;
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
		await this.serialize(() => this.closeSession("Caitlyn is shutting down."));
		await this.queue.stop();
		await this.dependencies.store.drain();
	}
}

export const transcriptionRuntimes = new WeakMap<Client, TranscriptionRuntime>();

export function configuredTranscriptionRuntime(client: Client): TranscriptionRuntime | undefined {
	const settings = transcriptionSettings();
	return settings.enabled ? new TranscriptionRuntime(client, settings.config) : undefined;
}
