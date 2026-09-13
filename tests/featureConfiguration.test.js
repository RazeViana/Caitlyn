/**
 * @file featureConfiguration.test.js
 * @description Verifies optional-feature isolation, safe diagnostics, and disabled runtime entry points.
 * Uses synthetic settings and mocked services; never logs secrets or connects to Discord/PostgreSQL.
 *
 * @module featureConfiguration.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Collection } from "discord.js";
import { getFeatureConfiguration, logFeatureConfiguration, validateEnvironment } from "../core/environment.ts";
import { startBot } from "../main.ts";
import { execute as interact } from "../events/interactionCreate.ts";
import { execute as toggle } from "../commands/utility/toggleai.ts";
import { enableAI, isAIEnabled, resetAIState } from "../core/aiState.ts";
import { configuredSocialRuntime } from "../core/socialRuntime.ts";
import { pool } from "../core/createPGPool.ts";
import { messageHandler } from "../handlers/messageHandler.ts";
import { execute as voice } from "../events/voiceStateUpdate.ts";
import { startCronJobs } from "../handlers/cronJobHandler.ts";

const database = { PGHOST: "localhost", PGPORT: "5432", PGUSER: "fixture", PGPASSWORD: "secret-fixture", PGDATABASE: "fixture" };
const ai = { OLLAMA_MODEL: "fixture", WEBUI_API_KEY: "secret-fixture", WEBUI_CHAT_ENDPOINT: "https://fixture.invalid/chat" };
const memory = { EMBEDDING_MODEL: "fixture", EMBEDDING_ENDPOINT: "https://fixture.invalid/embed" };

async function withEnvironment(values, action) {
	const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
	try {
		for (const [name, value] of Object.entries(values)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		await action();
	}
	finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		resetAIState();
	}
}

test("missing optional services do not disable independent features or disclose values", () => {
	assert.doesNotThrow(() => validateEnvironment({ TOKEN: "fixture" }));
	assert.ok(Object.values(getFeatureConfiguration({})).every((feature) => !feature.enabled));
	const configuration = getFeatureConfiguration({ ...ai, ...memory, LLM_ENABLED: "true", SOCIAL_MEDIA_ENABLED: "true", SOCIAL_WORKER_SOCKET: "/tmp/fixture.sock" });
	assert.equal(configuration.ai.enabled, true);
	for (const feature of ["database", "memory", "birthdayReminders", "socialMedia", "discordLogging"]) assert.equal(configuration[feature].enabled, false);
	const configured = getFeatureConfiguration({ ...database, ...ai, ...memory, GUILD_ID: "123", GENERAL_CHAT_ID: "456", SOCIAL_WORKER_SOCKET: "/tmp/fixture.sock" });
	assert.equal(configured.database.enabled, true);
	assert.equal(configured.memory.enabled, true);
	assert.equal(configured.birthdayReminders.enabled, true);
	assert.equal(configured.giphy.enabled, false);
	assert.equal(configured.ai.configured, true);
	assert.equal(configured.ai.enabled, false);
	assert.equal(configured.socialMedia.enabled, false);
	const logs = [];
	logFeatureConfiguration({ info: (...args) => logs.push(args.join(" ")), warn: (...args) => logs.push(args.join(" ")) }, { ...ai, LOG_LEVEL: "secret-fixture" });
	assert.ok(logs.some((line) => line.includes("PGHOST is missing")));
	assert.ok(logs.some((line) => line.includes("GIPHY_API_KEY is missing")));
	assert.ok(!logs.join(" ").includes("secret-fixture"));
	assert.ok(!logs.join(" ").includes("https://fixture.invalid"));
});

test("token-only startup skips optional services but loads commands/events and logs in", async () => {
	const calls = [];
	const unexpected = () => assert.fail("disabled service was started");
	const client = { destroy: async () => calls.push("destroy") };
	const bot = await startBot({
		validateEnvironment: () => validateEnvironment({ TOKEN: "fixture" }), configuration: () => getFeatureConfiguration({ TOKEN: "fixture" }),
		createClient: () => client, createSocialRuntime: unexpected, createLogForwarder: unexpected, createPGPool: unexpected, closeDatabase: unexpected,
		reportConfiguration: () => calls.push("configuration logs"),
		commandHandler: async () => calls.push("commands"), eventHandler: async () => calls.push("events"),
		drainEvents: async () => calls.push("drain"), loginClient: async () => calls.push("login"), startCronJobs: unexpected,
		logger: { info: () => undefined, error: unexpected },
	});
	await bot.stop();
	assert.deepEqual(calls, ["configuration logs", "commands", "events", "login", "drain", "destroy"]);
});

test("unconfigured database commands and autocomplete stop before command execution", async () => {
	await withEnvironment({ PGHOST: "" }, async () => {
		const replies = [];
		const command = { requiresDatabase: true, data: { name: "fixture" }, execute: async () => assert.fail("command executed"), autocomplete: async () => assert.fail("autocomplete executed") };
		const interaction = { commandName: "fixture", createdTimestamp: Date.now(), isAutocomplete: () => false, isChatInputCommand: () => true,
			client: { commands: new Collection([["fixture", command]]) }, reply: async (payload) => replies.push(payload), respond: async (options) => replies.push(options) };
		await interact(interaction);
		assert.match(replies[0].content, /feature is disabled.*database/);
		assert.equal(interaction.client.cooldowns, undefined);
		interaction.isAutocomplete = () => true;
		await interact(interaction);
		assert.deepEqual(replies[1], []);
	});
});

test("AI remains disabled with missing or invalid connection settings even after a runtime toggle", async (context) => {
	for (const values of [{ ...ai, WEBUI_API_KEY: "" }, { ...ai, WEBUI_CHAT_ENDPOINT: "secret-fixture" }, { ...ai, OLLAMA_MODEL: "" }]) {
		await withEnvironment({ ...values, LLM_ENABLED: "true" }, async () => {
			assert.equal(enableAI(), false);
			assert.equal(isAIEnabled(), false);
			const replies = [];
			context.mock.method(console, "warn", () => undefined);
			await toggle({ reply: async (payload) => replies.push(payload) });
			assert.match(replies[0].content, /AI is disabled.*configuration/);
			assert.equal(isAIEnabled(), false);
		});
	}
});

test("missing database settings stop default activity, memory, social and birthday work without queries", async (context) => {
	context.mock.method(pool, "query", () => assert.fail("database query attempted"));
	context.mock.method(pool, "connect", () => assert.fail("database connection attempted"));
	await withEnvironment({ PGHOST: "", LLM_ENABLED: "false", SOCIAL_MEDIA_ENABLED: "true" }, async () => {
		assert.equal(configuredSocialRuntime({}), undefined);
		await startCronJobs({})();
		await messageHandler({ guild: { id: "123" }, guildId: "123", client: {}, author: { id: "456", username: "fixture" }, content: "hello" });
		await voice({ channel: null }, { guild: { id: "123" }, member: { id: "456", user: { bot: false, username: "fixture" } }, channel: { id: "789", name: "fixture" } });
	});
});

test("database-dependent command metadata covers each persistence-backed command", async () => {
	for (const file of ["user/activity", "user/addbirthday", "user/removebirthday", "user/showbirthdays", "utility/leaderboard", "utility/streaks", "utility/setup", "utility/logs", "utility/social"]) {
		const command = await import(`../commands/${file}.ts`);
		assert.equal(command.requiresDatabase, true, file);
	}
	for (const file of ["utility/ping", "utility/server", "utility/user", "utility/reload", "utility/toggleai"]) {
		assert.notEqual((await import(`../commands/${file}.ts`)).requiresDatabase, true, file);
	}
});
