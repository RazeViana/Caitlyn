/**
 * @file transcriptionProgress.ts
 * @description Publishes short-lived, attendance-scoped inference status for the website.
 * @module transcriptionProgress
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { privateJson } from "./transcriptionFiles.js";
import type { PendingTranscription } from "./transcriptionQueue.js";

export class TranscriptionProgress {
	private timer?: NodeJS.Timeout;
	private running?: Promise<void>;
	private debounce?: NodeJS.Timeout;
	private again = false;
	private stopped = false;
	private warnedAt = -Infinity;
	private readonly directory: string;
	constructor(directory: string, private guildId: string, private snapshot: () => PendingTranscription[],
		private warn: () => void, private now = Date.now) {
		this.directory = join(directory, "assets", guildId);
	}

	async start(): Promise<void> {
		await this.refresh();
		this.timer = setInterval(() => { void this.refresh(); }, 2000);
		this.timer.unref();
	}

	changed(): void {
		if (this.stopped) return;
		clearTimeout(this.debounce);
		this.debounce = setTimeout(() => { void this.refresh(); }, 100);
		this.debounce.unref();
	}

	refresh(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		if (this.running) { this.again = true; return this.running; }
		this.running ??= (async () => {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			const updatedAt = this.now();
			const jobs = this.snapshot().filter((job) => job.guildId === this.guildId).slice(0, 33);
			await privateJson(join(this.directory, "progress.json"), {
				version: 1, guildId: this.guildId, updatedAt, expiresAt: updatedAt + 8000, jobs,
			});
		})().catch(() => {
			// Cosmetic telemetry must never interrupt capture or inference. A stale
			// snapshot expires independently at the server and in the browser.
			if (this.now() - this.warnedAt >= 60_000) {
				this.warnedAt = this.now();
				this.warn();
			}
		}).finally(() => {
			this.running = undefined;
			if (this.again && !this.stopped) { this.again = false; void this.refresh(); }
		});
		return this.running;
	}

	async stop(): Promise<void> {
		this.stopped = true;
		clearInterval(this.timer);
		clearTimeout(this.debounce);
		await this.running;
		try {
			await privateJson(join(this.directory, "progress.json"), {
				version: 1, guildId: this.guildId, updatedAt: this.now(), expiresAt: this.now(), jobs: [],
			});
		}
		catch {
			// An unwritable snapshot still expires within eight seconds.
		}
	}
}
