/**
 * @file interactionResponse.test.js
 * @description Tests expired and duplicate Discord acknowledgements without live API access.
 * Verifies failed acknowledgements stop command work and do not cause repeated error replies.
 *
 * @module interactionResponse.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Collection, MessageFlags } from "discord.js";
import { deferInteraction, respondWithError, skipUnavailableInteraction } from "../core/interactionResponse.ts";
import { execute } from "../events/interactionCreate.ts";
import { execute as configureSocial } from "../commands/utility/social.ts";
import logger from "../core/logger.ts";

function fixture(context, overrides = {}) {
	const warnings = [];
	context.mock.method(logger, "warn", (...args) => warnings.push(args));
	context.mock.method(logger, "debug", () => undefined);
	return { warnings, interaction: {
		createdTimestamp: Date.now(), commandName: "fixture", deferred: false, replied: false,
		deferReply: async () => assert.fail("unexpected acknowledgement"),
		reply: async () => assert.fail("unexpected initial reply"),
		editReply: async () => assert.fail("unexpected edit"),
		followUp: async () => assert.fail("unexpected followup"),
		...overrides,
	} };
}

test("expired commands are discarded before cooldowns, state changes, or API calls", async (context) => {
	const { interaction, warnings } = fixture(context, {
		createdTimestamp: Date.now() - 3_001,
		isAutocomplete: () => false, isChatInputCommand: () => true,
		client: { commands: new Collection([["fixture", { execute: () => assert.fail("executed stale command") }]]) },
	});
	await execute(interaction);
	assert.equal(interaction.client.cooldowns, undefined);
	assert.equal(await deferInteraction(interaction), false);
	await respondWithError(interaction);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0][0], /expired/);
});

test("unknown and already acknowledged interactions stop defer and error-response retries", async (context) => {
	for (const code of [10062, 10015, 40060]) {
		let attempts = 0;
		const { interaction, warnings } = fixture(context, {
			deferReply: async () => { attempts++; throw Object.assign(new Error("private response"), { code }); },
		});
		assert.equal(await deferInteraction(interaction, { flags: MessageFlags.Ephemeral }), false);
		assert.equal(await deferInteraction(interaction), false);
		await respondWithError(interaction);
		assert.equal(attempts, 1);
		assert.equal(warnings.length, 1);
		assert.ok(!JSON.stringify(warnings).includes("private response"));
		if (code === 40060) assert.match(warnings[0][0], /duplicate bot instances/);
	}
});

test("social configuration never reads or changes settings after rejected acknowledgement", async (context) => {
	const { interaction } = fixture(context, {
		commandName: "social", guildId: "111", channelId: "222",
		memberPermissions: { has: () => true },
		options: { getSubcommand: () => assert.fail("continued command after rejected defer") },
		deferReply: async () => { throw Object.assign(new Error("expired"), { code: 10062 }); },
	});
	await configureSocial(interaction);
});

test("successful deferrals preserve public or ephemeral response options", async (context) => {
	for (const options of [undefined, { flags: MessageFlags.Ephemeral }]) {
		const { interaction, warnings } = fixture(context, {
			deferReply: async (received) => { assert.deepEqual(received, options); interaction.deferred = true; },
		});
		assert.equal(await deferInteraction(interaction, options), true);
		interaction.createdTimestamp -= 60_000;
		assert.equal(skipUnavailableInteraction(interaction), false);
		assert.equal(warnings.length, 0);
	}
});

test("unrelated acknowledgement failures still propagate for normal error handling", async (context) => {
	const error = new Error("network unavailable");
	const { interaction } = fixture(context, { deferReply: async () => { throw error; } });
	await assert.rejects(deferInteraction(interaction), (received) => received === error);
});

test("expired followup tokens are logged once without cascading errors", async (context) => {
	let attempts = 0;
	const { interaction, warnings } = fixture(context, {
		deferred: true, createdTimestamp: Date.now() - 60_000,
		editReply: async () => { attempts++; throw Object.assign(new Error("expired token"), { code: 10015 }); },
	});
	await respondWithError(interaction);
	await respondWithError(interaction);
	assert.equal(attempts, 1);
	assert.equal(warnings.length, 1);
});
