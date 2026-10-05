/**
 * @file transcriptionQueue.ts
 * @description Bounds local inference work and records explicit gaps for overload, failures and shutdown.
 * @module transcriptionQueue
 */

import type { AudioChunk, RecognitionResult } from "./transcriptionAudio.js";
import type { TranscriptRecord } from "./transcriptionStore.js";

interface Job { chunk: AudioChunk; record: TranscriptRecord }
export interface PendingTranscription {
	eventId: string; guildId: string; channelId: string; channelName: string; sessionId: string;
	userId: string; speaker: string; at: string; end: string;
	audienceVersion: 1; audienceUserIds: string[]; phase: "queued" | "transcribing";
}

export class TranscriptionQueue {
	private jobs: Job[] = [];
	private running?: Promise<void>;
	private active?: Job;
	private abort = new AbortController();
	private closed = false;
	private failed = false;
	private dropped = new Map<string, TranscriptRecord>();
	lost = 0;
	constructor(
		private readonly transcribe: (pcm: Buffer, signal: AbortSignal) => Promise<string | RecognitionResult>,
		private readonly append: (record: TranscriptRecord) => Promise<void>,
		private readonly storageFailure: () => void,
		private readonly limit = 32,
		private readonly changed: () => void = () => undefined,
	) {}

	get pending(): number { return this.jobs.length + (this.running ? 1 : 0); }
	get healthy(): boolean { return !this.failed; }
	private notify(): void {
		try { this.changed(); }
		catch {
			// Progress listeners are optional and cannot interrupt recording.
		}
	}

	// Export only capture-time identity and audience, never PCM, recognized words
	// or the mutable current channel membership. The website checks this audience.
	activity(): PendingTranscription[] {
		if (this.failed) return [];
		return [...(this.active ? [this.active] : []), ...this.jobs].flatMap((job) => {
			const record = job.record;
			if (record.type !== "transcript" || !record.eventId || !record.userId || !record.end
				|| record.audienceVersion !== 1 || !record.audienceUserIds?.length) return [];
			return [{ eventId: record.eventId, guildId: record.guildId, channelId: record.channelId,
				channelName: record.channelName, sessionId: record.sessionId, userId: record.userId,
				speaker: record.speaker ?? "Discord member", at: record.at, end: record.end,
				audienceVersion: 1 as const, audienceUserIds: [...record.audienceUserIds],
				phase: job === this.active ? "transcribing" as const : "queued" as const }];
		});
	}

	write(record: TranscriptRecord): Promise<void> {
		return this.append(record).catch(() => {
			if (this.failed) return;
			this.failed = true;
			this.notify();
			this.storageFailure();
		});
	}

	push(chunk: AudioChunk, record: TranscriptRecord): void {
		if (this.closed || this.failed) return;
		if (this.jobs.length >= this.limit) {
			// Coalesce overload notices instead of growing an unbounded disk-write queue.
			this.lost++;
			const key = record.channelId;
			const previous = this.dropped.get(key);
			this.dropped.set(key, { ...record, at: previous?.at ?? record.at, type: "gap", userId: undefined, speaker: undefined,
				// A combined gap may cross a leave/rejoin boundary; keep it operator-only.
				audienceUserIds: previous ? [] : record.audienceUserIds,
				text: "Local transcription queue full; speech from one or more participants was lost during this interval." });
			return;
		}
		this.jobs.push({ chunk, record });
		this.kick();
		this.notify();
	}

	private kick(): void {
		if (this.running || this.failed || !this.jobs.length && !this.dropped.size) return;
		this.running = this.run().finally(() => {
			this.running = undefined;
			this.kick();
		});
	}

	private async run(): Promise<void> {
		while ((this.jobs.length || this.dropped.size) && !this.failed) {
			if (this.dropped.size) {
				const [key, gap] = this.dropped.entries().next().value!;
				this.dropped.delete(key);
				await this.write(gap);
				continue;
			}
			const job = this.jobs.shift()!;
			if (job.record.type === "gap") {
				await this.write(job.record);
				continue;
			}
			try {
				this.active = job;
				this.notify();
				const result = await this.transcribe(job.chunk.pcm, this.abort.signal);
				const text = typeof result === "string" ? result : result.text;
				if (text) await this.write({ ...job.record, text, ...(typeof result === "string" ? {} : { recognition: result.recognition }) });
			}
			catch {
				this.lost++;
				await this.write({ ...job.record, type: "gap", text: this.abort.signal.aborted
					? "Shutdown interrupted local transcription; this audio was discarded."
					: "Local speech recognition failed; this audio was discarded." });
			}
			finally { this.active = undefined; this.notify(); }
		}
		this.jobs = [];
		this.dropped.clear();
	}

	async drain(): Promise<void> { while (this.running) await this.running; }

	async stop(graceMs = 7000): Promise<void> {
		this.closed = true;
		const timer = setTimeout(() => {
			this.abort.abort();
			for (const job of this.jobs) {
				this.lost++;
				job.record = { ...job.record, type: "gap", text: "Shutdown discarded pending audio before transcription." };
			}
		}, graceMs);
		try { await this.drain(); }
		finally { clearTimeout(timer); }
	}
}
