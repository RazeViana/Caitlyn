/**
 * @file socialRuntime.ts
 * @description Runs opt-in social jobs outside message events with bounded retries and conservative send recovery.
 * Fences stale workers, cleans up only complete replacements, and uses private operator logging.
 *
 * @module socialRuntime
 */

import { MessageFlags, ChannelType, type Client, type Message } from "discord.js";
import logger from "./logger.js";
import { withLogGuild } from "./logContext.js";
import { withTimeout } from "./asyncTools.js";
import { extractSocialLinks, socialJobPostId, supportedSocialLink } from "./socialLinks.js";
import { socialDeliveryStore, type SocialDeliveryStore } from "./socialDeliveryStore.js";
import { requestSocialWorker, SOCIAL_FILE_LIMIT, SOCIAL_TOTAL_LIMIT } from "./socialWorkerClient.js";
import { renderSocialPost } from "./socialPostRender.js";
import { sanitizeXPostDiagnostic } from "./socialXPost.js";
import { getFeatureConfiguration } from "./environment.js";
import { startSocialProgress } from "./socialProgress.js";
import { createSocialDiscordDelivery, SOCIAL_PREVIEW_FOOTER, socialSourceHash, type SocialDiscordDelivery } from "../messages/socialDelivery.js";
import type { SocialJob, SocialWorkerRequest, SocialWorkerResult } from "../types/socialDelivery.js";

export interface SocialRuntimeDependencies {
	store: SocialDeliveryStore;
	delivery: SocialDiscordDelivery;
	worker: (input: SocialWorkerRequest, signal: AbortSignal) => Promise<SocialWorkerResult>;
	ready: () => boolean;
	now: () => number;
	logger: Pick<typeof logger, "debug" | "info" | "success" | "warn" | "error">;
	sendTimeoutMs?: number;
}

export function createSocialRuntime(dependencies: SocialRuntimeDependencies) {
	const { store, delivery } = dependencies;
	let stopping = false;
	let running: Promise<boolean> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	let lastIdleLog = -Infinity;
	let started = false;
	let wakeRequested = false;
	const log = dependencies.logger;

	async function cleanupSource(job: SocialJob): Promise<void> {
		try {
			const replacements = await store.sourceReplacements(job);
			const outcome = await delivery.deleteSource(job, replacements);
			await store.finishSourceDelete(job, outcome);
			if (outcome === "deleted") log.success("Social original removed after confirmed replacement", job.source_id);
			else log.warn("Social original retained; source changed, extra content, or deletion permission unavailable", job.source_id);
		}
		catch {
			// Keep the durable deleting marker even if Discord accepted deletion but its acknowledgement was lost.
			await store.finish(job, "sent", "source_delete_uncertain");
			log.warn("Social source cleanup uncertain; replacements retained for reconciliation", job.source_id);
		}
	}

	async function processJob(job: SocialJob): Promise<void> {
		let sendStarted = job.status === "uncertain" || job.status === "sending";
		let stopProgress: (() => void) | undefined;
		try {
			if (job.status === "sent") {
				if (job.source_cleanup === "deleted") {
					await store.finish(job, "sent", "source_deleted");
					return;
				}
				if (job.source_cleanup === "deleting") {
					await cleanupSource(job);
					return;
				}
				const valid = await delivery.sourceValid(job);
				if (valid && job.source_cleanup === "pending") {
					const postIds = job.replacement_ready ? await delivery.replacementPlan(job) : undefined;
					if (!postIds?.length) {
						await store.finishSourceDelete(job, "retained");
						log.warn("Social original retained; incomplete replacement, extra content, or missing Manage Messages", job.source_id);
					}
					else if (await store.beginSourceDelete(job, postIds)) {
						await cleanupSource(job);
						return;
					}
				}
				await store.finish(job, valid ? "sent" : "removing", valid ? "source_unchanged" : "source_changed");
				return;
			}
			if (job.status === "removing") {
				await delivery.remove(job);
				await store.finish(job, "cancelled", "preview_removed");
				log.info("Social preview removed", job.id);
				return;
			}
			if (sendStarted) {
				const messageId = await delivery.find(job);
				if (messageId) {
					await store.sent(job, messageId);
					log.success("Social delivery reconciled", job.id);
				}
				else {
					await store.finish(job, "uncertain", "send_not_confirmed");
					log.warn("Social send remains uncertain; no resend", job.id);
				}
				return;
			}
			if (stopping || !await store.enabled(job.guild_id, job.channel_id) || !await delivery.sourceValid(job)) {
				await store.finish(job, "cancelled", "source_or_settings_changed");
				return;
			}
			controller = new AbortController();
			stopProgress = startSocialProgress({ typing: (signal) => delivery.typing(job, signal),
				unavailable: () => log.debug("Social cooking indicator unavailable; preview processing continues", job.id) });
			controller.signal.addEventListener("abort", stopProgress, { once: true });
			const extractionStarted = dependencies.now();
			log.info("Social extraction started", job.id, `attempt=${job.attempts}`);
			// A public content-warning label is not a provider access denial. The owner permits these previews.
			const result = await dependencies.worker({ version: 1, url: job.url, attachmentBytes: SOCIAL_FILE_LIMIT, totalBytes: SOCIAL_TOTAL_LIMIT, allowSensitive: true }, controller.signal);
			log.info("Social extraction finished", job.id, `duration_ms=${Math.max(0, dependencies.now() - extractionStarted)}`);
			if (result.provider === "fxembed") log.info("Social extraction provider mode", job.id, "mode=fxembed");
			if (result.provider === "tiktok") log.info("Social extraction provider mode", job.id, "mode=tiktok");
			if (!("post" in result)) {
				const retry = ["worker_unavailable", "timeout"].includes(result.outcome) && job.attempts < 3;
				await store.finish(job, retry ? "queued" : "failed", result.outcome);
				const diagnostic = sanitizeXPostDiagnostic(result.diagnostic);
				log.warn("Social extraction unavailable; original preserved", job.id, result.outcome,
					...(diagnostic ? [JSON.stringify(diagnostic)] : []));
				return;
			}
			job.sensitive = result.post.sensitive === true || (result.post.quote?.state === "available" && result.post.quote.post.sensitive === true);
			if (stopping || !await delivery.sourceValid(job)) {
				await store.finish(job, "cancelled", "source_or_shutdown_changed");
				return;
			}
			if (result.post.platform === "tiktok") {
				const resolution = await store.resolveTikTok(job, result.post.url);
				if (resolution !== "send") {
					if (resolution === "blocked") await store.finish(job, "failed", "duplicate_unconfirmed");
					log.info("Social duplicate resolution completed", job.id, resolution);
					return;
				}
			}
			const rendered = renderSocialPost(result.post, result.files, { attachmentBytes: SOCIAL_FILE_LIMIT, messageBytes: SOCIAL_TOTAL_LIMIT }, job.author_id);
			const embeds = rendered.payload.embeds as { footer?: { text: string } }[];
			embeds[rendered.footerEmbedIndex].footer = { text: SOCIAL_PREVIEW_FOOTER };
			log.debug("Social preview rendered", job.id, `embeds=${embeds.length}`, `files=${rendered.payload.files?.length ?? 0}`,
				`text_attachment=${rendered.textFileAttached}`, `complete=${rendered.complete}`);
			if (result.files.some((file) => file.compressed)) log.info("Social video compressed to upload budget", job.id);
			if (!rendered.complete || result.outcome === "partial") log.warn("Social preview is partial", job.id, `omitted=${rendered.omittedMedia}`, result.mediaFailures?.join(",") ?? "");
			// An unacknowledged claim never authorizes a send; persisted sending state is reconciled.
			sendStarted = true;
			if (!await store.beginSend(job, result.outcome === "ready" && rendered.complete, job.sensitive)) return;
			const sendingStarted = dependencies.now();
			const operation = delivery.send(job, rendered.payload).then(async (messageId) => {
				await store.sent(job, messageId);
				log.success("Social preview delivered", job.id, `send_ms=${Math.max(0, dependencies.now() - sendingStarted)}`);
			});
			await withTimeout(operation, dependencies.sendTimeoutMs ?? 15_000, "social_send");
		}
		catch {
			const status = job.status === "sent" ? "sent" : job.status === "removing" ? "removing" : sendStarted ? "uncertain" : job.attempts < 3 ? "queued" : "failed";
			await store.finish(job, status, sendStarted ? "send_uncertain" : "service_failure").catch(() => {
				log.error("Social state update failed; durable claim retained", job.id);
			});
			log.warn("Social job interrupted; original preserved", job.id, status);
		}
		finally {
			stopProgress?.();
			if (stopProgress) controller?.signal.removeEventListener("abort", stopProgress);
		}
	}

	async function run(): Promise<boolean> {
		if (stopping || !dependencies.ready()) return false;
		try {
			const job = await store.claim();
			if (job) {
				await withLogGuild(job.guild_id, () => processJob(job));
				return true;
			}
			else if (dependencies.now() - lastIdleLog >= 5 * 60_000) {
				lastIdleLog = dependencies.now();
				log.debug("Social queue idle");
			}
		}
		catch { log.error("Social queue unavailable; will check again"); }
		return false;
	}

	function schedule(milliseconds: number): void {
		clearTimeout(timer);
		if (!started || stopping) return;
		timer = setTimeout(() => {
			wakeRequested = false;
			void runtime.tick().then((worked) => schedule(worked || wakeRequested ? 0 : 5_000));
		}, milliseconds);
		timer.unref();
	}

	function wake(): void {
		wakeRequested = true;
		if (!running) schedule(0);
	}

	const runtime = {
		async enqueue(message: Message): Promise<void> {
			if (stopping || !message.guildId || message.author.bot || message.webhookId || message.channel.type !== ChannelType.GuildText
				|| message.flags.has(MessageFlags.SuppressEmbeds) || dependencies.now() - message.createdTimestamp > 30 * 60_000) return;
			const links = extractSocialLinks(message.content).filter(supportedSocialLink);
			if (!links.length) return;
			try {
				if (!await store.enabled(message.guildId, message.channelId)) return;
				for (const link of links) {
					const accepted = await store.enqueue({ guild_id: message.guildId, channel_id: message.channelId, source_id: message.id,
						author_id: message.author.id, source_hash: socialSourceHash(message.content), post_id: socialJobPostId(link), url: link.url });
					log.debug(accepted ? "Social job queued" : "Social job not queued (duplicate, capacity, or disabled)", message.id, link.key);
					if (accepted) wake();
				}
			}
			catch { log.warn("Social enqueue failed; original preserved", message.id); }
		},
		async cancel(guildId: string, channelId: string, sourceId: string): Promise<void> {
			try {
				await store.cancelSource(guildId, channelId, sourceId);
				wake();
			}
			catch { log.warn("Social cancellation could not be saved; source will be checked again", sourceId); }
		},
		async tick(): Promise<boolean> {
			if (running || stopping) return false;
			running = run();
			try { return await running; }
			finally { running = undefined; }
		},
		start(): void {
			if (started || stopping) return;
			started = true;
			schedule(0);
		},
		async stop(): Promise<void> {
			stopping = true;
			clearTimeout(timer);
			controller?.abort();
			if (running) await withTimeout(running, 8_000, "social_shutdown");
		},
	};
	return runtime;
}

export type SocialRuntime = ReturnType<typeof createSocialRuntime>;
export const socialRuntimes = new WeakMap<Client, SocialRuntime>();

export function configuredSocialRuntime(client: Client): SocialRuntime | undefined {
	if (!getFeatureConfiguration().socialMedia.enabled) return;
	return createSocialRuntime({ store: socialDeliveryStore, delivery: createSocialDiscordDelivery(client),
		worker: (input, signal) => requestSocialWorker(process.env.SOCIAL_WORKER_SOCKET ?? "", input, signal),
		ready: () => client.isReady(), now: Date.now, logger });
}
