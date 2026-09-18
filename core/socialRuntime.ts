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
import { sanitizeInstagramReason } from "./socialInstagramPost.js";
import { renderInstagramAccessNotice } from "./socialAccessNotice.js";
import { getFeatureConfiguration } from "./environment.js";
import { startSocialProgress } from "./socialProgress.js";
import { logData } from "./dataLog.js";
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
			if (outcome === "deleted") log.success("Original message deleted after the social preview was confirmed", job.source_id);
			else log.warn("Original message kept; it changed, contains extra content, or the bot cannot delete it", job.source_id);
		}
		catch {
			// Keep the durable deleting marker even if Discord accepted deletion but its acknowledgement was lost.
			await store.finish(job, "sent", "source_delete_uncertain");
			log.warn("Could not confirm whether the original message was deleted; keeping the social previews and checking again later", job.source_id);
		}
	}

	async function processJob(job: SocialJob): Promise<void> {
		const details = { server: job.guild_id, channel: job.channel_id, user: job.author_id, message: job.source_id, job: job.id };
		logData("Checking a saved social preview task", { ...details, status: job.status }, log.debug);
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
						log.warn("Original message kept; the preview is incomplete, there is extra content, or the bot needs Manage Messages permission", job.source_id);
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
					log.success("Found the social preview already in Discord; no second copy sent", job.id);
				}
				else {
					await store.finish(job, "uncertain", "send_not_confirmed");
					log.warn("Could not confirm whether the social preview was sent; no second copy will be sent", job.id);
				}
				return;
			}
			if (stopping || !await store.enabled(job.guild_id, job.channel_id) || !await delivery.sourceValid(job)) {
				await store.finish(job, "cancelled", "source_or_settings_changed");
				return;
			}
			controller = new AbortController();
			stopProgress = startSocialProgress({ typing: (signal) => delivery.typing(job, signal),
				unavailable: () => log.debug("Could not show the typing indicator; still preparing the social preview", job.id) });
			controller.signal.addEventListener("abort", stopProgress, { once: true });
			const extractionStarted = dependencies.now();
			log.info("Getting the social post's text and media", job.id, `attempt: ${job.attempts}`);
			// A public content-warning label is not a provider access denial. The owner permits these previews.
			const result = await dependencies.worker({ version: 1, url: job.url, attachmentBytes: SOCIAL_FILE_LIMIT, totalBytes: SOCIAL_TOTAL_LIMIT, allowSensitive: true }, controller.signal);
			log.info("Finished checking the social post", job.id, `time taken: ${Math.max(0, dependencies.now() - extractionStarted)} ms`);
			if (result.provider === "fxembed") log.info("Social post checked using", job.id, "FxEmbed (X posts)");
			if (result.provider === "tiktok") log.info("Social post checked using", job.id, "TikTok");
			if (result.provider === "instagram") log.info("Social post checked using", job.id, "Instagram without signing in");
			if (!("post" in result)) {
				const diagnostic = sanitizeXPostDiagnostic(result.diagnostic);
				const instagramReason = result.provider === "instagram" ? sanitizeInstagramReason(result.instagramReason) : undefined;
				log.warn("Could not get the social post; original message kept", job.id, result.outcome,
					...(diagnostic ? [JSON.stringify(diagnostic)] : []), ...(instagramReason ? [`instagram_reason=${instagramReason}`] : []));
				const notice = renderInstagramAccessNotice(job.url, job.author_id, result);
				if (notice) {
					if (stopping || !await delivery.sourceValid(job)) {
						await store.finish(job, "cancelled", "source_or_shutdown_changed");
						return;
					}
					const embed = notice.embeds![0] as { footer?: { text: string }; description?: string };
					embed.description += "\n\nYour original message has been kept.";
					embed.footer = { text: SOCIAL_PREVIEW_FOOTER };
					// Reuse durable nonce/reconciliation; a notice is NEVER a complete replacement.
					sendStarted = true;
					if (!await store.beginSend(job, false, false)) return;
					const operation = delivery.send(job, notice, { notice: true }).then(async (messageId) => {
						await store.sent(job, messageId);
						log.info("Sent an explanation that Instagram access is limited; original message kept", job.id, instagramReason);
					});
					await withTimeout(operation, dependencies.sendTimeoutMs ?? 15_000, "social_access_notice");
					return;
				}
				const retry = ["worker_unavailable", "timeout"].includes(result.outcome) && job.attempts < 3;
				await store.finish(job, retry ? "queued" : "failed", result.outcome);
				return;
			}
			job.sensitive = result.post.sensitive === true || (result.post.quote?.state === "available" && result.post.quote.post.sensitive === true);
			const quoted = result.post.quote?.state === "available" ? result.post.quote.post : undefined;
			const media = [...result.post.media, ...(quoted?.media ?? [])];
			logData("Collected social post details; captions, links and media content are not included in logs", {
				...details, platform: result.post.platform ?? "x", post: result.post.id,
				characters: result.post.text.length + (quoted?.text.length ?? 0), quote: Boolean(quoted),
				images: media.filter((item) => item.kind === "image").length, videos: media.filter((item) => item.kind !== "image").length,
				files: result.files.length, bytes: result.files.reduce((total, file) => total + file.data.length, 0),
				fields: "post and author details, caption, media, quote details when present",
			}, log.debug);
			if (stopping || !await delivery.sourceValid(job)) {
				await store.finish(job, "cancelled", "source_or_shutdown_changed");
				return;
			}
			if (result.post.platform === "tiktok") {
				const resolution = await store.resolveTikTok(job, result.post.url);
				if (resolution !== "send") {
					if (resolution === "blocked") await store.finish(job, "failed", "duplicate_unconfirmed");
					log.info("TikTok link check finished; no new preview sent", job.id, resolution);
					return;
				}
			}
			const rendered = renderSocialPost(result.post, result.files, { attachmentBytes: SOCIAL_FILE_LIMIT, messageBytes: SOCIAL_TOTAL_LIMIT }, job.author_id);
			const embeds = rendered.payload.embeds as { footer?: { text: string } }[];
			embeds[rendered.footerEmbedIndex].footer = { text: SOCIAL_PREVIEW_FOOTER };
			log.debug("Social preview prepared", job.id, `cards: ${embeds.length}`, `files: ${rendered.payload.files?.length ?? 0}`,
				`text saved in a file: ${rendered.textFileAttached}`, `complete: ${rendered.complete}`);
			if (result.files.some((file) => file.compressed)) log.info("Video made smaller to fit Discord's upload limit", job.id);
			if (!rendered.complete || result.outcome === "partial") log.warn("Social preview is missing some content; original message will be kept", job.id, `media items left out: ${rendered.omittedMedia}`, result.mediaFailures?.join(",") ?? "");
			// An unacknowledged claim never authorizes a send; persisted sending state is reconciled.
			sendStarted = true;
			if (!await store.beginSend(job, result.outcome === "ready" && rendered.complete, job.sensitive)) return;
			const sendingStarted = dependencies.now();
			const operation = delivery.send(job, rendered.payload).then(async (messageId) => {
				await store.sent(job, messageId);
				log.success("Social preview sent", job.id, `time to send: ${Math.max(0, dependencies.now() - sendingStarted)} ms`);
			});
			await withTimeout(operation, dependencies.sendTimeoutMs ?? 15_000, "social_send");
		}
		catch {
			const status = job.status === "sent" ? "sent" : job.status === "removing" ? "removing" : sendStarted ? "uncertain" : job.attempts < 3 ? "queued" : "failed";
			await store.finish(job, status, sendStarted ? "send_uncertain" : "service_failure").catch(() => {
				log.error("Could not save social preview progress; the earlier database record is still in place", job.id);
			});
			log.warn("Social preview processing stopped before finishing", job.id, status);
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
				log.debug("No social posts waiting to be processed");
			}
		}
		catch { log.error("Could not load waiting social posts from the database; will try again"); }
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
					logData(accepted ? "Saved social preview request to the waiting list" : "Social post not added; already waiting, waiting list full, or feature turned off", {
						server: message.guildId, channel: message.channelId, user: message.author.id, message: message.id,
						platform: link.platform, fields: accepted ? "server, channel, message and sender IDs, post link and ID, message change check" : "none",
					}, log.debug);
					if (accepted) wake();
				}
			}
			catch { log.warn("Could not add the social post to the waiting list; original message kept", message.id); }
		},
		async cancel(guildId: string, channelId: string, sourceId: string): Promise<void> {
			try {
				await store.cancelSource(guildId, channelId, sourceId);
				wake();
			}
			catch { log.warn("Could not save the request to cancel this social preview; will check the original message again", sourceId); }
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
