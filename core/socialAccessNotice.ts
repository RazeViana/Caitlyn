/**
 * @file socialAccessNotice.ts
 * @description Renders bounded Instagram access notices only for explicit private or login-required responses.
 * Rate limits, bot challenges, missing metadata and generic denials must not be labelled private.
 *
 * @module socialAccessNotice
 */

import type { MessageCreateOptions } from "discord.js";
import type { SocialWorkerFailure } from "../types/socialDelivery.js";
import { parseSocialLink } from "./socialLinks.js";

export function renderInstagramAccessNotice(url: string, sharedBy: string, failure: SocialWorkerFailure): MessageCreateOptions | undefined {
	const link = parseSocialLink(url);
	if (link?.platform !== "instagram" || link.kind !== "post" || link.url !== url || !/^[1-9]\d{0,19}$/.test(sharedBy)
		|| failure.provider !== "instagram" || failure.outcome !== "restricted"
		|| !["private_post", "login_required", "http_401"].includes(failure.instagramReason ?? "")) return;
	const privatePost = failure.instagramReason === "private_post";
	return { embeds: [{ color: 0xe1306c, title: privatePost ? "🔒 Private Instagram post" : "🔒 Instagram login required",
		description: `${privatePost ? "This post is private, so I can’t preview it here. Open it on Instagram with an account that has access."
			: "This post is private or requires an Instagram login, so I can’t preview it here. You may still be able to view it on Instagram."}\n\n[Open on Instagram ↗](${url})\nShared by <@${sharedBy}>`,
		footer: { text: "Your original message has been kept." } }], allowedMentions: { parse: [], repliedUser: false } };
}
