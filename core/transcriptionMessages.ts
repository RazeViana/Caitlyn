/**
 * @file transcriptionMessages.ts
 * @description Archives observed guild chat and revisions independently of voice sessions, using source-channel identities.
 * @module transcriptionMessages
 */

import { Events, type Client, type ClientEvents, type Message, type PartialMessage } from "discord.js";
import type { TranscriptRecord } from "./transcriptionStore.js";
import { captureAttachments } from "./transcriptionAssets.js";
import { logForwarders } from "./discordLogForwarder.js";

/** Use the same live destination as the logger, including setup changes and database refreshes. */
export function shouldArchiveMessageChannel(client: Client, guildId: string, channelId: string, threadParentId?: string | null): boolean {
	const forwarder = logForwarders.get(client);
	if (!forwarder) return true;
	const logChannelId = forwarder.logChannelId(guildId);
	// Until log settings load, do not risk copying operational logs into conversations.
	return logChannelId !== undefined && (logChannelId === null || channelId !== logChannelId && threadParentId !== logChannelId);
}

interface TrackedMessage { original?: TranscriptRecord; latest: TranscriptRecord }
type MessageEvent = "message_posted" | "message_edited" | "message_deleted";

export class TranscriptionMessages {
	private readonly messages = new Map<string, TrackedMessage>();
	private tail: Promise<void> = Promise.resolve();
	private stopped = false;
	private pending = 0;

	constructor(private readonly client: Client, private readonly guildId: string,
		private readonly write: (record: TranscriptRecord) => Promise<void>, private readonly healthy: () => boolean,
		private readonly reference?: (messageId: string) => Promise<TranscriptRecord | undefined>,
		private readonly now = Date.now) {}

	private readonly created = (message: Message): void => { this.capture(message, "message_posted", message.createdTimestamp); };
	private readonly updated = (_before: Message | PartialMessage, after: Message | PartialMessage): void => {
		if (!after.partial && after.editedTimestamp) this.capture(after, "message_edited", after.editedTimestamp);
	};
	private readonly deleted = (message: Message | PartialMessage): void => { this.capture(message, "message_deleted", this.now()); };
	private readonly bulkDeleted = (messages: ClientEvents[Events.MessageBulkDelete][0]): void => {
		for (const message of messages.values()) this.deleted(message);
	};

	start(): void {
		this.client.on(Events.MessageCreate, this.created);
		this.client.on(Events.MessageUpdate, this.updated);
		this.client.on(Events.MessageDelete, this.deleted);
		this.client.on(Events.MessageBulkDelete, this.bulkDeleted);
	}

	private capture(message: Message | PartialMessage, type: MessageEvent, at: number): void {
		if (this.stopped || !this.healthy() || !message.inGuild() || message.guildId !== this.guildId
			|| message.system || !Number.isFinite(at)) return;
		const threadParentId = message.channel.isThread() ? message.channel.parentId ?? message.channel.parent?.id : undefined;
		if (!shouldArchiveMessageChannel(this.client, this.guildId, message.channelId, threadParentId)) return;
		// Snapshot immediately: discord.js may mutate the cached message before an
		// asynchronous original-message lookup or file write has finished.
		const parent = message.channel.isThread() ? message.channel.parent : null;
		const record: TranscriptRecord = {
			eventId: type === "message_posted" ? `message-${message.id}`
				: type === "message_deleted" ? `message-delete-${message.id}` : `message-edit-${message.id}-${at}`,
			type, at: new Date(at).toISOString(), guildId: this.guildId,
			channelId: message.channelId, channelName: message.channel.name,
			sessionId: `messages-${message.channelId}`, audienceVersion: 1, audienceUserIds: [],
			userId: message.author?.id, speaker: message.author?.username,
			avatarHash: message.author?.avatar,
			activityChannelId: message.channelId, activityChannelName: message.channel.name,
			activityParentChannelId: threadParentId ?? undefined, activityParentChannelName: parent?.name,
			messageId: message.id, messageUrl: message.url,
			text: type === "message_deleted" ? undefined : message.content ?? undefined,
			attachmentNames: type === "message_deleted" ? [] : [...message.attachments.values()].map((item) => item.name),
			attachments: type === "message_deleted" ? [] : captureAttachments(message.attachments.values(), message.channelId),
		};
		this.pending++;
		this.tail = this.tail.then(() => this.save(record)).finally(() => { this.pending--; });
	}

	private async save(record: TranscriptRecord): Promise<void> {
		if (!this.healthy() || !shouldArchiveMessageChannel(this.client, this.guildId, record.channelId, record.activityParentChannelId)) return;
		const tracked = this.messages.get(record.messageId!);
		if (tracked && (record.type === "message_posted" || tracked.latest.type === "message_deleted"
			|| Date.parse(record.at) <= Date.parse(tracked.latest.at) && record.type === "message_edited")) return;
		if (record.type === "message_edited" && tracked && record.text === tracked.latest.text
			&& JSON.stringify(record.attachmentNames) === JSON.stringify(tracked.latest.attachmentNames)
			&& JSON.stringify(record.attachments?.map((item) => item.id)) === JSON.stringify(tracked.latest.attachments?.map((item) => item.id))) return;
		const original = record.type === "message_posted" ? record : tracked?.original
			?? await this.reference?.(record.messageId!).catch(() => undefined);
		if (record.type !== "message_posted") {
			record.targetEventId = original?.eventId;
			record.userId ??= original?.userId;
			record.speaker ??= original?.speaker;
		}
		// A setup change can happen while the original-message lookup is pending.
		if (!shouldArchiveMessageChannel(this.client, this.guildId, record.channelId, record.activityParentChannelId)) return;
		await this.write(record);
		this.messages.set(record.messageId!, { original, latest: record });
		if (this.messages.size > 2048) this.messages.delete(this.messages.keys().next().value!);
	}

	get queued(): number { return this.pending; }

	async stop(): Promise<void> {
		this.stopped = true;
		this.client.off(Events.MessageCreate, this.created);
		this.client.off(Events.MessageUpdate, this.updated);
		this.client.off(Events.MessageDelete, this.deleted);
		this.client.off(Events.MessageBulkDelete, this.bulkDeleted);
		await this.tail;
	}
}
