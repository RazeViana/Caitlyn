/**
 * @file socialDelivery.test.js
 * @description Checks source preflights, safe reply options, identity-scoped reconciliation, and preview removal.
 * Mocks Discord channels and messages; never sends or deletes a live message.
 *
 * @module socialDelivery.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ChannelType, Collection, PermissionFlagsBits, MessageFlags } from "discord.js";
import { createSocialDiscordDelivery, legacySocialMarker, SOCIAL_PREVIEW_FOOTER, socialNonce, socialSourceHash } from "../messages/socialDelivery.ts";

function fixture() {
	const job = { id: "12345678-1234-1234-1234-123456789abc", guild_id: "111", channel_id: "222", source_id: "333", author_id: "444",
		source_hash: socialSourceHash("original"), message_id: "555" };
	const source = { author: { id: "444", bot: false }, content: "original", flags: { has: () => false } };
	const calls = [];
	const preview = { id: "555", author: { id: "999" }, reference: { messageId: "333" }, embeds: [{ footer: { text: legacySocialMarker(job) } }],
		delete: async () => { calls.push(["delete", "555"]); } };
	const history = new Collection([["555", preview]]);
	const channel = { type: ChannelType.GuildText, guildId: "111", guild: { members: { me: {} } }, permissionsFor: () => ({ has: () => true }),
		messages: { fetch: async (options) => {
			calls.push(["fetch", options]);
			return options.message === "333" ? source : options.message === "555" ? preview : history;
		} }, send: async (options) => { calls.push(["send", options]); return { id: "555" }; } };
	const client = { user: { id: "999" }, channels: { fetch: async () => channel } };
	return { job, source, calls, preview, history, channel, client, delivery: createSocialDiscordDelivery(client) };
}

test("Discord social replies preserve originals, suppress mentions, and use a stable nonce", async () => {
	const f = fixture();
	assert.equal(await f.delivery.sourceValid(f.job), true);
	assert.equal(await f.delivery.send(f.job, { content: "preview" }), "555");
	const payload = f.calls.find(([name]) => name === "send")[1];
	assert.deepEqual(payload.allowedMentions, { parse: [], users: ["444"], repliedUser: false });
	assert.equal(payload.reply, undefined);
	assert.equal(payload.content, "original");
	assert.equal(payload.enforceNonce, true);
	assert.ok(payload.nonce.length <= 25);
	assert.ok(!f.calls.some(([name]) => name === "delete"));
});

test("access notices reply without copying commentary or pinging the original sender", async () => {
	const f = fixture();
	await f.delivery.send(f.job, { embeds: [{ title: "Private Instagram post" }] }, { notice: true });
	const payload = f.calls.find(([name]) => name === "send")[1];
	assert.equal(payload.content, undefined);
	assert.deepEqual(payload.reply, { messageReference: "333", failIfNotExists: true });
	assert.deepEqual(payload.allowedMentions, { parse: [], users: [], repliedUser: false });
	assert.equal(payload.nonce, socialNonce(f.job));
	assert.equal(payload.enforceNonce, true);
	assert.ok(!f.calls.some(([name]) => name === "delete"));
});

test("mixed X/TikTok sources require every namespaced replacement and retain unsupported photo links", async () => {
	const f = fixture();
	f.source.content = "caption https://x.com/alice/status/123 https://www.tiktok.com/@creator/video/123 https://www.tiktok.com/@creator/photo/456";
	f.job.source_hash = socialSourceHash(f.source.content);
	assert.deepEqual(await f.delivery.replacementPlan(f.job), ["123", "tiktok:123"]);
	await f.delivery.send(f.job, { embeds: [] });
	const content = f.calls.find(([name]) => name === "send")[1].content;
	assert.ok(content.includes("caption"));
	assert.ok(content.includes("/photo/456"));
	assert.ok(!content.includes("/video/123") && !content.includes("/status/123"));
});

test("typing feedback checks the source/permissions and ignores late work after cancellation", async () => {
	const f = fixture();
	f.channel.sendTyping = async () => f.calls.push(["typing"]);
	await f.delivery.typing(f.job);
	assert.equal(f.calls.at(-1)[0], "typing");
	f.source.content = "edited";
	await assert.rejects(f.delivery.typing(f.job), /source_changed/);
	assert.equal(f.calls.filter(([name]) => name === "typing").length, 1);
	f.source.content = "original";
	const controller = new AbortController();
	const fetch = f.channel.messages.fetch;
	f.channel.messages.fetch = async (options) => {
		controller.abort();
		return fetch(options);
	};
	await f.delivery.typing(f.job, controller.signal);
	assert.equal(f.calls.filter(([name]) => name === "typing").length, 1);
	f.channel.permissionsFor = () => ({ has: () => false });
	await assert.rejects(f.delivery.typing(f.job), /missing_permissions/);
});

test("source edits, suppression, webhook/bot authors, deletion, and missing permissions prevent delivery", async () => {
	for (const mutate of [
		(f) => { f.source.content = "edited"; },
		(f) => { f.source.flags.has = (flag) => flag === MessageFlags.SuppressEmbeds; },
		(f) => { f.source.author.bot = true; },
		(f) => { f.source.author.id = "777"; },
		(f) => { f.source.webhookId = "888"; },
	]) {
		const f = fixture();
		mutate(f);
		assert.equal(await f.delivery.sourceValid(f.job), false);
		await assert.rejects(() => f.delivery.send(f.job, {}));
		assert.ok(!f.calls.some(([name]) => name === "send"));
	}
	const f = fixture();
	f.channel.messages.fetch = async () => { throw Object.assign(new Error("gone"), { code: 10008 }); };
	assert.equal(await f.delivery.sourceValid(f.job), false);
	f.channel.permissionsFor = () => ({ has: () => false });
	await assert.rejects(() => f.delivery.sourceValid(f.job), /missing_permissions/);
	await assert.rejects(() => f.delivery.send(f.job, {}), /missing_permissions/);
});

test("preview reconciliation is bounded and requires own bot identity, source reply, and job marker", async () => {
	for (const mutate of [
		(f) => { f.preview.author.id = "888"; },
		(f) => { f.preview.reference.messageId = "444"; },
		(f) => { f.preview.embeds[0].footer.text = "spoofed"; },
	]) {
		const f = fixture();
		mutate(f);
		assert.equal(await f.delivery.find(f.job), undefined);
		await assert.rejects(() => f.delivery.remove(f.job), /identity_mismatch/);
		assert.ok(!f.calls.some(([name]) => name === "delete"));
	}
	const f = fixture();
	assert.equal(await f.delivery.find(f.job), "555");
	assert.deepEqual(f.calls[0][1], { after: "333", limit: 100, cache: false });
	// Removal still works if only upload/embed/send permissions have been revoked.
	f.channel.permissionsFor = () => ({ has: (permissions) => !permissions.includes(PermissionFlagsBits.AttachFiles) });
	await f.delivery.remove(f.job);
	assert.deepEqual(f.calls.at(-1), ["delete", "555"]);
	f.channel.messages.fetch = async () => { throw Object.assign(new Error("gone"), { code: 10008 }); };
	await assert.doesNotReject(() => f.delivery.remove(f.job));
});

test("Discord social delivery refuses other guilds, unsupported channels, and unavailable history", async () => {
	for (const change of [{ guildId: "other" }, { type: ChannelType.DM }, { type: ChannelType.PublicThread }]) {
		const f = fixture();
		Object.assign(f.channel, change);
		await assert.rejects(() => f.delivery.send(f.job, {}), /channel_unavailable/);
	}
	const f = fixture();
	f.channel.messages.fetch = async () => { throw new Error("history unavailable"); };
	await assert.rejects(() => f.delivery.find(f.job));
	await assert.rejects(() => f.delivery.sourceValid(f.job));
});

function replacementFixture() {
	const f = fixture();
	Object.assign(f.job, { source_cleanup: "deleting", status: "sent", replacement_ready: true, cancel_requested: false, post_id: "123" });
	f.source.content = "caption @everyone https://x.com/alice/status/123";
	f.job.source_hash = socialSourceHash(f.source.content);
	f.source.delete = async () => { f.calls.push(["delete", "333"]); };
	f.preview.reference = undefined;
	return f;
}

test("source replacement preserves the caption and allows only the original sender mention", async () => {
	const f = replacementFixture();
	await f.delivery.send(f.job, { content: "untrusted @everyone", allowedMentions: { parse: ["everyone"] } });
	const payload = f.calls.find(([name]) => name === "send")[1];
	assert.equal(payload.content, "caption @everyone");
	assert.deepEqual(payload.allowedMentions, { parse: [], users: ["444"], repliedUser: false });
	assert.deepEqual(await f.delivery.replacementPlan(f.job), ["123"]);
	assert.equal(await f.delivery.deleteSource(f.job, [f.job]), "deleted");
	assert.deepEqual(f.calls.at(-1), ["delete", "333"]);
	assert.equal(await f.delivery.find(f.job), "555");
});

test("clean footers use persisted message identity for recovery and safe source cleanup", async () => {
	const f = replacementFixture();
	f.preview.embeds[0].footer.text = SOCIAL_PREVIEW_FOOTER;
	assert.equal(await f.delivery.find(f.job), "555");
	assert.equal(await f.delivery.deleteSource(f.job, [f.job]), "deleted");
	await f.delivery.remove(f.job);
	assert.deepEqual(f.calls.at(-1), ["delete", "555"]);
});

test("quote previews remain identifiable when the clean footer is on the lower quoted card", async () => {
	const f = replacementFixture();
	f.preview.embeds = [{ description: "Quoting tweet" }, { description: "Quoted content\n\nShared by <@444>", footer: { text: SOCIAL_PREVIEW_FOOTER } }];
	f.preview.nonce = socialNonce(f.job);
	assert.equal(await f.delivery.find({ ...f.job, message_id: null }), "555");
	assert.equal(await f.delivery.deleteSource(f.job, [f.job]), "deleted");
	await f.delivery.remove(f.job);
	assert.deepEqual(f.calls.at(-1), ["delete", "555"]);
});

test("uncertain clean-footer sends require the matching Discord nonce, not just an identical caption", async () => {
	const f = replacementFixture();
	f.job.message_id = null;
	f.preview.embeds[0].footer.text = SOCIAL_PREVIEW_FOOTER;
	f.preview.nonce = socialNonce(f.job);
	assert.equal(await f.delivery.find(f.job), "555");
	for (const nonce of [undefined, null, "wrong-job", 12345678]) {
		f.preview.nonce = nonce;
		assert.equal(await f.delivery.find(f.job), undefined);
	}
	// Older sends remain recoverable without nonce metadata or a persisted message ID.
	f.preview.embeds[0].footer.text = legacySocialMarker(f.job);
	assert.equal(await f.delivery.find(f.job), "555");
});

test("clean-footer identity rejects wrong authors, webhooks, references and conflicting message IDs", async () => {
	for (const mutate of [
		(f) => { f.preview.author.id = "other"; },
		(f) => { f.preview.webhookId = "webhook"; },
		(f) => { f.preview.reference = { messageId: "other-source" }; },
		(f) => { f.preview.id = "different-message"; },
		(f) => { f.preview.embeds[0].footer.text = "different-footer"; },
	]) {
		const f = replacementFixture();
		f.preview.embeds[0].footer.text = SOCIAL_PREVIEW_FOOTER;
		f.preview.nonce = socialNonce(f.job);
		mutate(f);
		assert.equal(await f.delivery.find(f.job), undefined);
		assert.equal(await f.delivery.deleteSource(f.job, [f.job]), "retained");
		assert.ok(!f.calls.some(([name]) => name === "delete"));
	}
});

test("link-only sources have no standalone text and keep attribution and source links inside the embed", async () => {
	for (const content of ["https://x.com/alice/status/123", "https://twitter.com/alice/status/123/video/1?share=1"]) {
		const f = replacementFixture();
		f.source.content = content;
		f.job.source_hash = socialSourceHash(content);
		const embeds = [{ description: "Caption\n\nX · Text · [Original ↗](https://x.com/alice/status/123)\n\nShared by <@444>", url: "https://x.com/alice/status/123", footer: { text: SOCIAL_PREVIEW_FOOTER } }];
		await f.delivery.send(f.job, { embeds });
		const payload = f.calls.find(([name]) => name === "send")[1];
		assert.equal(payload.content, undefined);
		assert.deepEqual(payload.embeds, embeds);
		assert.equal(f.source.content, content);
		assert.deepEqual(await f.delivery.replacementPlan(f.job), ["123"]);
	}
});

test("multiple preview links are omitted together while unrelated links remain in the caption", async () => {
	const f = replacementFixture();
	f.source.content = "Compare these\nhttps://x.com/alice/status/123\nhttps://x.com/bob/status/456\nhttps://example.com/context";
	f.job.source_hash = socialSourceHash(f.source.content);
	await f.delivery.send(f.job, {});
	const payload = f.calls.find(([name]) => name === "send")[1];
	assert.equal(payload.content, "Compare these\nhttps://example.com/context");
	assert.deepEqual(await f.delivery.replacementPlan(f.job), ["123", "456"]);
});

test("moving attribution never expands cleanup eligibility for legacy previews with omitted commentary", async () => {
	const f = replacementFixture();
	const prefix = "Shared by <@444>\n";
	f.source.content = `${"a".repeat(2_000 - prefix.length)} https://x.com/alice/status/123`;
	f.job.source_hash = socialSourceHash(f.source.content);
	assert.deepEqual(await f.delivery.replacementPlan(f.job), ["123"]);
	f.source.content = `a${f.source.content}`;
	f.job.source_hash = socialSourceHash(f.source.content);
	await f.delivery.send(f.job, { embeds: [{ description: "Post content\n\nShared by <@444>" }] });
	const payload = f.calls.find(([name]) => name === "send")[1];
	assert.equal(payload.content, "Original message retained; sender commentary is too long to copy.");
	assert.equal(payload.embeds[0].description, "Post content\n\nShared by <@444>");
	assert.equal(await f.delivery.replacementPlan(f.job), undefined);
	assert.equal(await f.delivery.deleteSource(f.job, [f.job]), "retained");
	assert.ok(!f.calls.some(([name]) => name === "delete"));
});

test("source cleanup refuses missing permission, changed content, extra data, or incomplete replacements", async () => {
	for (const mutate of [
		(f) => { f.source.content = "edited caption"; },
		(f) => { f.source.attachments = new Collection([["upload", {}]]); },
		(f) => { f.source.stickers = new Collection([["sticker", {}]]); },
		(f) => { f.source.poll = {}; },
		(f) => { f.source.reference = { messageId: "999" }; },
		(f) => { f.source.hasThread = true; },
		(f) => { f.source.content = "a".repeat(2_000); f.job.source_hash = socialSourceHash(f.source.content); },
		(f) => { f.job.replacement_ready = false; },
		(f) => { f.job.source_cleanup = "pending"; },
		(f) => { f.job.status = "uncertain"; },
		(f) => { f.job.cancel_requested = true; },
		(f) => { f.preview.author.id = "other"; },
		(f) => { f.channel.permissionsFor = () => ({ has: (permissions) => permissions !== PermissionFlagsBits.ManageMessages }); },
	]) {
		const f = replacementFixture();
		mutate(f);
		assert.equal(await f.delivery.deleteSource(f.job, [f.job]), "retained");
		assert.ok(!f.calls.some(([name]) => name === "delete"));
	}
});

test("source removal contains known Discord errors and leaves ambiguous network failures recoverable", async () => {
	for (const [code, expected] of [[10008, "deleted"], [50013, "retained"], [50001, "retained"]]) {
		const f = replacementFixture();
		f.source.delete = async () => { throw Object.assign(new Error("failed"), { code }); };
		assert.equal(await f.delivery.deleteSource(f.job, [f.job]), expected);
	}
	const f = replacementFixture();
	f.source.delete = async () => { throw new Error("connection reset after deletion"); };
	await assert.rejects(f.delivery.deleteSource(f.job, [f.job]), /connection reset/);
	const fetch = f.channel.messages.fetch;
	f.channel.messages.fetch = async (options) => {
		if (options.message === "333") throw Object.assign(new Error("gone"), { code: 10008 });
		return fetch(options);
	};
	assert.equal(await f.delivery.deleteSource(f.job, [f.job]), "deleted");
});

test("public sensitive previews and confirmed source cleanup do not depend on the channel age flag", async () => {
	for (const nsfw of [false, true]) {
		const f = replacementFixture();
		f.job.sensitive = true;
		f.channel.nsfw = nsfw;
		assert.equal(await f.delivery.sourceValid(f.job), true);
		assert.equal(await f.delivery.send(f.job, {}), "555");
		assert.equal(await f.delivery.deleteSource(f.job, [f.job]), "deleted");
	}
});
