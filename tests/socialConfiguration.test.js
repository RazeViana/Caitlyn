/**
 * @file socialConfiguration.test.js
 * @description Exercises administrator channel opt-ins and source edit/delete cancellation events.
 * Keeps command publication, database writes, and Discord operations behind deterministic substitutes.
 *
 * @module socialConfiguration.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ChannelType, Collection, MessageFlags, PermissionFlagsBits } from "discord.js";
import { data, execute } from "../commands/utility/social.ts";
import { socialRuntimes } from "../core/socialRuntime.ts";
import { execute as update } from "../events/messageUpdate.ts";
import { execute as deleted } from "../events/messageDelete.ts";
import { execute as bulkDeleted } from "../events/messageDeleteBulk.ts";

function fixture(action = "enable") {
	const calls = [];
	const interaction = { client: {}, guildId: "111", channelId: "222", channel: { type: ChannelType.GuildText },
		memberPermissions: { has: () => true }, options: { getSubcommand: () => action },
		deferReply: async (payload) => { interaction.deferred = true; calls.push(["defer", payload]); },
		editReply: async (payload) => { calls.push(["edit", payload]); }, reply: async (payload) => { calls.push(["reply", payload]); } };
	const store = { settings: async () => [{ channel_id: "222", enabled: true }], configure: async (...args) => { calls.push(["configure", ...args]); } };
	return { interaction, store, calls };
}

test("social configuration is administrator-only and disabled integration cannot opt channels in", async () => {
	assert.equal(data.toJSON().default_member_permissions, PermissionFlagsBits.Administrator.toString());
	const f = fixture();
	await execute(f.interaction, f.store);
	assert.ok(!f.calls.some(([name]) => name === "configure"));
	assert.match(f.calls.at(-1)[1], /operator must enable/);
	f.interaction.memberPermissions.has = () => false;
	await execute(f.interaction, f.store);
	assert.match(f.calls.at(-1)[1].content, /Only server administrators/);
});

test("social commands configure only their guild/current text channel with ephemeral confirmation", async () => {
	for (const action of ["enable", "disable", "disable-server", "status"]) {
		const f = fixture(action);
		socialRuntimes.set(f.interaction.client, {});
		await execute(f.interaction, f.store);
		assert.equal(f.calls[0][1].flags, MessageFlags.Ephemeral);
		if (action === "status") {
			assert.deepEqual(f.calls.at(-1)[1].allowedMentions, { parse: [] });
			assert.match(f.calls.at(-1)[1].content, /<#222>/);
		}
		else {assert.deepEqual(f.calls[1], ["configure", "111", action === "disable-server" ? null : "222", action === "enable"]);}
		socialRuntimes.delete(f.interaction.client);
	}
	const f = fixture();
	f.interaction.channel.type = ChannelType.PublicThread;
	await execute(f.interaction, f.store);
	assert.ok(!f.calls.some(([name]) => name === "configure"));
});

test("social settings database failures preserve the saved state and provide recovery guidance", async () => {
	const f = fixture("disable");
	f.store.configure = async () => { throw new Error("secret database string"); };
	await execute(f.interaction, f.store);
	assert.match(f.calls.at(-1)[1].content, /migration 014/);
	assert.ok(!JSON.stringify(f.calls).includes("secret"));
});

test("native embed-only updates are ignored while edits, suppression, and deletes cancel scoped jobs", async () => {
	const calls = [];
	const message = { client: {}, guildId: "111", channelId: "222", id: "333", author: { bot: false }, content: "original", editedTimestamp: null, flags: { has: () => false } };
	socialRuntimes.set(message.client, { cancel: async (...args) => { calls.push(args); } });
	await update(message, { ...message });
	assert.equal(calls.length, 0);
	await update(message, { ...message, content: "changed" });
	await update(message, { ...message, flags: { has: () => true } });
	await deleted({ ...message, content: null, author: null });
	await bulkDeleted(new Collection([["333", message]]));
	assert.deepEqual(calls, Array.from({ length: 4 }, () => ["111", "222", "333"]));
	socialRuntimes.delete(message.client);
});
