/**
 * @file socialDelivery.ts
 * @description Sends attributed previews and deletes unchanged sources only after durable replacement approval.
 * Keeps sender commentary outside the attributed card and verifies identity before reconciliation or cleanup.
 *
 * @module socialDelivery
 */

import { createHash } from "node:crypto";
import { ChannelType, MessageFlags, PermissionFlagsBits, type Client, type Message, type MessageCreateOptions, type TextChannel } from "discord.js";
import type { SocialJob } from "../types/socialDelivery.js";
import { withTimeout } from "../core/asyncTools.js";
import { extractSocialLinks, socialJobPostId, socialPostCaption, supportedSocialLink } from "../core/socialLinks.js";

export function socialSourceHash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export const SOCIAL_PREVIEW_FOOTER = "Caitlyn preview";

/** Existing previews retain their original marker; new messages never display this ID. */
export function legacySocialMarker(job: SocialJob): string {
	return `Caitlyn preview • ${job.id}`;
}

export function socialNonce(job: SocialJob): string {
	return job.id.replaceAll("-", "").slice(0, 25);
}

export function createSocialDiscordDelivery(client: Client) {
	async function channel(job: SocialJob, sending = false): Promise<TextChannel> {
		const destination = await client.channels.fetch(job.channel_id, { force: true });
		if (!destination || destination.type !== ChannelType.GuildText || destination.guildId !== job.guild_id) throw new Error("channel_unavailable");
		const member = destination.guild.members.me ?? await destination.guild.members.fetchMe();
		const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
		if (sending) required.push(PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles);
		if (!destination.permissionsFor(member)?.has(required)) throw new Error("missing_permissions");
		return destination;
	}

	function matches(message: Message, job: SocialJob): boolean {
		if (message.author.id !== client.user?.id || message.webhookId
			|| (message.reference && message.reference.messageId !== job.source_id)
			|| (job.message_id && message.id !== job.message_id)) return false;
		if (message.embeds.some((embed) => embed.footer?.text === legacySocialMarker(job))) return true;
		if (!message.embeds.some((embed) => embed.footer?.text === SOCIAL_PREVIEW_FOOTER)) return false;
		// A shared footer alone cannot identify a job. REST may omit nonce, so stay uncertain then.
		return job.message_id === message.id || (typeof message.nonce === "string" && message.nonce === socialNonce(job));
	}

	function unchanged(source: Message, job: SocialJob): boolean {
		return !source.author.bot && !source.webhookId && source.author.id === job.author_id
			&& !source.flags.has(MessageFlags.SuppressEmbeds) && socialSourceHash(source.content) === job.source_hash;
	}

	function captionFits(caption: string, job: SocialJob): boolean {
		// Retain the earlier message budget: recovered legacy previews may have omitted longer commentary.
		return `Shared by <@${job.author_id}>${caption ? `\n${caption}` : ""}`.length <= 2_000;
	}

	function replaceable(source: Message, job: SocialJob): boolean {
		// Attachments, stickers, polls, replies, threads, and long messages are not copied by this handler.
		return unchanged(source, job) && captionFits(socialPostCaption(source.content), job)
			&& !source.attachments?.size && !source.stickers?.size && !source.poll && !source.reference && !source.hasThread;
	}

	return {
		async typing(job: SocialJob, signal?: AbortSignal): Promise<void> {
			if (signal?.aborted) return;
			const destination = await channel(job, true);
			const source = await destination.messages.fetch({ message: job.source_id, force: true });
			if (!unchanged(source, job)) throw new Error("source_changed");
			if (signal?.aborted) return;
			await destination.sendTyping();
		},
		async sourceValid(job: SocialJob): Promise<boolean> {
			return withTimeout((async () => {
				const destination = await channel(job);
				let source: Message;
				try { source = await destination.messages.fetch({ message: job.source_id, force: true }); }
				catch (error) {
					if ((error as { code?: number }).code === 10008) return false;
					throw error;
				}
				return unchanged(source, job);
			})(), 10_000, "social_source_check");
		},
		async send(job: SocialJob, payload: MessageCreateOptions, options: { notice?: boolean } = {}): Promise<string> {
			const destination = await channel(job, true);
			const source = await destination.messages.fetch({ message: job.source_id, force: true });
			if (!unchanged(source, job)) throw new Error("source_changed");
			const caption = socialPostCaption(source.content);
			const message = await destination.send({ ...payload,
				// The renderer owns the in-card attribution; link-only messages need no standalone content.
				content: options.notice ? undefined : captionFits(caption, job) ? caption || undefined : "Original message retained; sender commentary is too long to copy.",
				allowedMentions: { parse: [], users: options.notice ? [] : [job.author_id], repliedUser: false },
				reply: options.notice ? { messageReference: job.source_id, failIfNotExists: true } : undefined,
				nonce: socialNonce(job), enforceNonce: true });
			return message.id;
		},
		async replacementPlan(job: SocialJob): Promise<string[] | undefined> {
			const destination = await channel(job);
			const source = await destination.messages.fetch({ message: job.source_id, force: true });
			const member = destination.guild.members.me ?? await destination.guild.members.fetchMe();
			if (!replaceable(source, job) || !destination.permissionsFor(member)?.has(PermissionFlagsBits.ManageMessages)) return;
			return extractSocialLinks(source.content).filter(supportedSocialLink).map(socialJobPostId);
		},
		async deleteSource(job: SocialJob, replacements: SocialJob[]): Promise<"deleted" | "retained"> {
			return withTimeout((async () => {
				const destination = await channel(job);
				if (!replacements.length || replacements.some((item) => item.source_cleanup !== "deleting" || item.status !== "sent"
					|| !item.replacement_ready || item.source_hash !== job.source_hash || item.author_id !== job.author_id
					|| item.guild_id !== job.guild_id || item.channel_id !== job.channel_id || item.source_id !== job.source_id
					|| item.cancel_requested)) return "retained";
				// A prior delete may have succeeded even if its acknowledgement was lost.
				try { await destination.messages.fetch({ message: job.source_id, force: true }); }
				catch (error) {
					if ((error as { code?: number }).code === 10008) return "deleted";
					throw error;
				}
				for (const item of replacements) {
					let preview: Message;
					try { preview = await destination.messages.fetch({ message: item.message_id!, force: true }); }
					catch (error) {
						if ((error as { code?: number }).code === 10008) return "retained";
						throw error;
					}
					if (!matches(preview, item)) return "retained";
				}
				let source: Message;
				try { source = await destination.messages.fetch({ message: job.source_id, force: true }); }
				catch (error) {
					if ((error as { code?: number }).code === 10008) return "deleted";
					throw error;
				}
				const member = destination.guild.members.me ?? await destination.guild.members.fetchMe();
				if (!replaceable(source, job) || !destination.permissionsFor(member)?.has(PermissionFlagsBits.ManageMessages)) return "retained";
				try { await source.delete(); }
				catch (error) {
					const code = (error as { code?: number }).code;
					if (code === 10008) return "deleted";
					if (code === 50013 || code === 50001) return "retained";
					throw error;
				}
				return "deleted";
			})(), 10_000, "social_source_removal");
		},
		async find(job: SocialJob): Promise<string | undefined> {
			return withTimeout((async () => {
				const destination = await channel(job);
				// A bounded search can confirm a send, never prove that a send did not happen.
				const messages = await destination.messages.fetch({ after: job.source_id, limit: 100, cache: false });
				return messages.find((message) => matches(message, job))?.id;
			})(), 10_000, "social_reconciliation");
		},
		async remove(job: SocialJob): Promise<void> {
			await withTimeout((async () => {
				const destination = await channel(job);
				try {
					const message = await destination.messages.fetch({ message: job.message_id!, force: true });
					if (!matches(message, job)) throw new Error("preview_identity_mismatch");
					await message.delete();
				}
				catch (error) {
					if ((error as { code?: number }).code !== 10008) throw error;
				}
			})(), 10_000, "social_preview_removal");
		},
	};
}

export type SocialDiscordDelivery = ReturnType<typeof createSocialDiscordDelivery>;
