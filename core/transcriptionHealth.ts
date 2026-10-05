/**
 * @file transcriptionHealth.ts
 * @description Checks recording dependencies and publishes content-free health through Caitlyn's shared logger and a private heartbeat.
 * @module transcriptionHealth
 */

import { readFile, statfs } from "node:fs/promises";
import { join } from "node:path";
import { privateJson } from "./transcriptionFiles.js";
import { logData } from "./dataLog.js";
import logger from "./logger.js";

export interface RecordingHealth {
	discordReady: boolean;
	paused: boolean;
	recording: boolean;
	storageHealthy: boolean;
	captureHealthy?: boolean;
	pending: number;
	lost: number;
	lastPacketAt: number;
	lastSavedAt: number;
	archive?: { state: string; stalled: boolean; quarantined: number };
}

export class TranscriptionHealth {
	private timer?: NodeJS.Timeout;
	private running?: Promise<void>;
	private problems = new Map<string, number>();
	private previousLost = 0;
	private lifetimeLost = 0;
	private nextReminder = 0;
	private lastBackup = 0;
	summary = "checking dependencies";
	constructor(private readonly directory: string, private readonly guildId: string, private readonly endpoint: string,
		private readonly snapshot: () => RecordingHealth,
		private readonly expectBackup = false,
		private readonly dependencies = { fetch, statfs, now: Date.now, log: logger }) {}

	async start(): Promise<void> {
		try {
			const previous = JSON.parse(await readFile(join(this.directory, "health.json"), "utf8"));
			if (Number.isSafeInteger(previous.lifetimeLost) && previous.lifetimeLost >= 0) this.lifetimeLost = previous.lifetimeLost;
		}
		catch {
			// A missing heartbeat is expected on the first start.
		}
		await this.check();
		this.timer = setInterval(() => { void this.check(); }, 30_000);
		this.timer.unref();
	}

	check(): Promise<void> {
		this.running ??= this.inspect().catch(() => {
			this.summary = "health check failed";
			this.problem("heartbeat", true, "Transcription health check could not save its heartbeat.");
		}).finally(() => { this.running = undefined; });
		return this.running;
	}

	private problem(key: string, active: boolean, message: string): void {
		const now = this.dependencies.now();
		if (active) {
			if (!this.problems.has(key) || now - this.problems.get(key)! >= 900_000) {
				logData(message, { server: this.guildId, status: key }, this.dependencies.log.warn);
				this.problems.set(key, now);
			}
		}
		else if (this.problems.delete(key)) {logData("Transcription dependency recovered.", { server: this.guildId, status: key }, this.dependencies.log.success);}
	}

	private async inspect(): Promise<void> {
		const now = this.dependencies.now();
		const state = this.snapshot();
		const checks = await Promise.allSettled([
			this.dependencies.statfs(this.directory),
			(async () => {
				const response = await this.dependencies.fetch(new URL("/health", this.endpoint), { signal: AbortSignal.timeout(4000), redirect: "error" });
				if (!response.ok) {
					await response.body?.cancel();
					return false;
				}
				const value = await response.json() as { ready?: boolean };
				return value.ready === true;
			})(),
		]);
		const disk = checks[0].status === "fulfilled" ? checks[0].value : undefined;
		const freeBytes = disk ? Number(disk.bavail) * Number(disk.bsize) : null;
		const workerReady = checks[1].status === "fulfilled" && checks[1].value;
		this.problem("heartbeat", false, "");
		this.problem("storage", !state.storageHealthy || freeBytes === null, "Transcription storage is unavailable; recording needs attention.");
		this.problem("disk", freeBytes !== null && freeBytes < 1024 ** 3, "Transcription disk space is below 1 GiB.");
		this.problem("worker", !workerReady, "Local transcription worker is unavailable; queued speech may be lost.");
		this.problem("discord", !state.discordReady, "Transcription is waiting for Discord to reconnect.");
		this.problem("capture", state.captureHealthy === false, "An occupied channel is eligible for recording but audio capture is unavailable; check voice permissions and compatibility.");
		this.problem("archive", state.archive?.stalled === true, "Transcript database import is stalled; local logs are preserved.");
		this.problem("queue", state.pending >= 24, "Transcription is falling behind; the speech queue is nearly full.");
		if (state.lost > this.previousLost) {
			this.lifetimeLost += state.lost - this.previousLost;
			logData("Speech segments were lost; gap entries describe the affected recording intervals.", { server: this.guildId, count: state.lost - this.previousLost }, this.dependencies.log.warn);
		}
		this.previousLost = state.lost;
		if (this.expectBackup) {
			let backup: { completedAt?: number; restoreVerified?: boolean; failed?: boolean } = {};
			try { backup = JSON.parse(await readFile(join(this.directory, "backup-status.json"), "utf8")); }
			catch {
				// Missing status must be visible to the operator.
			}
			const healthy = backup.restoreVerified === true && !backup.failed && typeof backup.completedAt === "number" && now - backup.completedAt < 36 * 3_600_000;
			this.problem("backup", !healthy, "Transcript backup is missing, overdue or failed restore verification.");
			if (healthy && backup.completedAt !== this.lastBackup) {
				this.lastBackup = backup.completedAt!;
				logData("Transcript backup completed and restored successfully in an isolated verification database.", { server: this.guildId }, this.dependencies.log.success);
			}
		}
		this.summary = this.problems.size ? `needs attention: ${[...this.problems.keys()].join(", ")}` : "healthy";
		if (now >= this.nextReminder) {
			logData("Transcription health checked.", { server: this.guildId, status: this.summary, count: state.pending, enabled: !state.paused }, this.dependencies.log.debug);
			this.nextReminder = now + 300_000;
		}
		await privateJson(join(this.directory, "health.json"), { version: 1, checkedAt: now, healthy: !this.problems.size,
			...state, workerReady, freeBytes, lifetimeLost: this.lifetimeLost, problems: [...this.problems.keys()] });
	}

	async stop(): Promise<void> { if (this.timer) clearInterval(this.timer); await this.running; }
}
