/**
 * @file birthdayDelivery.ts
 * @description Renders bounded birthday announcements and reconciles uncertain Discord delivery.
 * Identifies this bot's messages by a persisted reference without assuming history absence proves failure.
 *
 * @module birthdayDelivery
 */

import { ChannelType, PermissionFlagsBits, type Client, type MessageCreateOptions } from "discord.js";
import { withTimeout } from "../core/asyncTools.js";
import type { BirthdayDelivery } from "../core/birthdayDeliveryStore.js";

export function birthdayReference(delivery: BirthdayDelivery): string {
	return `Birthday reference: ${delivery.id}`;
}

export function birthdayPayload(delivery: BirthdayDelivery): MessageCreateOptions {
	return {
		content: [
			"🎉🎂 **It's Party Time!** 🎂🎉",
			"Today we're celebrating these fellas:",
			`\n${delivery.recipient_ids.map((id) => `🎂 <@${id}> 🥳`).join("\n")}`,
			"\nSend them my regards 🥳",
			`\n-# ${birthdayReference(delivery)}`,
		].join("\n"),
		allowedMentions: { parse: [], users: delivery.recipient_ids },
		nonce: delivery.id.replaceAll("-", "").slice(0, 25),
		enforceNonce: true,
	};
}

export interface BirthdayChannel {
	send: (delivery: BirthdayDelivery) => Promise<string>;
	find: (delivery: BirthdayDelivery) => Promise<string | undefined>;
}

export async function getBirthdayChannel(client: Client, delivery: BirthdayDelivery): Promise<BirthdayChannel> {
	const guild = await withTimeout(client.guilds.fetch(delivery.guild_id), 8_000, "Birthday guild lookup");
	const channel = await withTimeout(guild.channels.fetch(delivery.channel_id, { force: true }), 8_000, "Birthday channel lookup");
	if (channel?.type !== ChannelType.GuildText || channel.guildId !== delivery.guild_id) {
		throw new Error("Birthday destination must be a text channel in the configured server");
	}
	const member = await withTimeout(guild.members.fetchMe(), 8_000, "Birthday bot permission lookup");
	if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory])) {
		throw new Error("Birthday channel requires View Channel, Send Messages, and Read Message History permissions");
	}
	return {
		send: async (row) => (await channel.send(birthdayPayload(row))).id,
		async find(row) {
			let before: string | undefined;
			// A bounded scan is sufficient to confirm a match, never to authorize a resend.
			for (let page = 0; page < 5; page++) {
				const messages = await withTimeout(channel.messages.fetch({ limit: 100, before, cache: false }), 8_000, "Birthday history lookup");
				const found = messages.find((message) => message.author.id === client.user?.id && !message.webhookId
					&& message.content.endsWith(`-# ${birthdayReference(row)}`));
				if (found) return found.id;
				const oldest = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
				if (messages.size < 100 || !oldest || oldest.id === before
					|| (row.started_at && oldest.createdTimestamp < row.started_at.getTime() - 60_000)) return undefined;
				before = oldest.id;
			}
			return undefined;
		},
	};
}
