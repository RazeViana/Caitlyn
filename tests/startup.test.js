/**
 * @file startup.test.js
 * @description Tests startup ordering, required intents, and deployment configuration validation.
 * Checks malformed settings and optional defaults before any real service is contacted.
 *
 * @module startup.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayIntentBits } from "discord.js";
import { getFeatureConfiguration, logFeatureConfiguration, validateEnvironment } from "../core/environment.ts";

const validEnvironment = {
	TOKEN: "startup-test-token",
	GUILD_ID: "123456789012345678",
	GENERAL_CHAT_ID: "234567890123456789",
	GIPHY_API_KEY: "test-giphy-key",
	PGHOST: "localhost",
	PGPORT: "5432",
	PGUSER: "test-user",
	PGPASSWORD: "test-password",
	PGDATABASE: "test-database",
	OLLAMA_MODEL: "test-chat-model",
	WEBUI_API_KEY: "test-webui-key",
	WEBUI_CHAT_ENDPOINT: "http://localhost:8080/api/chat/completions",
	EMBEDDING_MODEL: "test-embedding-model",
	EMBEDDING_ENDPOINT: "http://localhost:11434/api/embeddings",
};

test("startup preserves initialization order and required Discord intents", async () => {
	const originalToken = process.env.TOKEN;
	const processEvents = ["uncaughtException", "unhandledRejection", "SIGTERM", "SIGINT"];
	const listenerCounts = new Map(processEvents.map((event) => [event, process.listenerCount(event)]));
	process.env.TOKEN = "startup-test-token";

	try {
		const { startBot } = await import("../main.ts");
		const calls = [];
		const client = { destroy: async () => undefined };
		let receivedIntents;

		await startBot({
			closeDatabase: async () => undefined,
			drainEvents: async () => undefined,
			validateEnvironment: () => {
				validateEnvironment(validEnvironment);
				calls.push("validate environment");
			},
			commandHandler: async (receivedClient) => {
				assert.equal(receivedClient, client);
				calls.push("load commands");
			},
			createClient: (intents) => {
				receivedIntents = intents;
				calls.push("create client");
				return client;
			},
			createPGPool: async () => {
				calls.push("initialize PostgreSQL");
			},
			eventHandler: async (receivedClient) => {
				assert.equal(receivedClient, client);
				calls.push("load events");
			},
			loginClient: async (receivedClient) => {
				assert.equal(receivedClient, client);
				calls.push("log in");
			},
			logger: {
				error: () => undefined,
				info: () => undefined,
			},
			startCronJobs: (receivedClient) => {
				assert.equal(receivedClient, client);
				calls.push("start cron jobs");
				return async () => undefined;
			},
		});

		assert.deepEqual(calls, [
			"validate environment",
			"create client",
			"initialize PostgreSQL",
			"load commands",
			"load events",
			"log in",
			"start cron jobs",
		]);
		assert.deepEqual(receivedIntents, [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildVoiceStates,
		]);
		for (const event of processEvents) {
			assert.equal(process.listenerCount(event), listenerCounts.get(event));
		}
	}
	finally {
		if (originalToken === undefined) {
			delete process.env.TOKEN;
		}
		else {
			process.env.TOKEN = originalToken;
		}
	}
});

test("deployment rejects missing TOKEN, CLIENT_ID, or GUILD_ID", async () => {
	const { deployCommands } = await import("../core/deployCommands.ts");
	const deploymentEnvironment = {
		CLIENT_ID: "client-id",
		GUILD_ID: "guild-id",
		TOKEN: "token",
	};

	for (const variable of Object.keys(deploymentEnvironment)) {
		for (const value of [undefined, "", "   "]) {
			await assert.rejects(
				deployCommands({ ...deploymentEnvironment, [variable]: value }),
				new RegExp(`No ${variable} found`),
			);
		}
	}
});

test("startup accepts documented optional defaults and AI configuration while disabled", () => {
	assert.doesNotThrow(() => validateEnvironment(validEnvironment));
	assert.doesNotThrow(() => validateEnvironment({
		...validEnvironment,
		LLM_ENABLED: "false",
		SOCIAL_MEDIA_ENABLED: "false",
		LOG_LEVEL: "warn",
		CONTEXT_RECENT_COUNT: "0",
		CONTEXT_SIMILAR_COUNT: "3",
		BIRTHDAY_TIMEZONE: "Europe/Brussels",
	}));
});

test("only TOKEN is fatal; absent optional settings disable their respective feature", () => {
	const owners = { GUILD_ID: "birthdayReminders", GENERAL_CHAT_ID: "birthdayReminders", GIPHY_API_KEY: "giphy",
		PGHOST: "database", PGPORT: "database", PGUSER: "database", PGPASSWORD: "database", PGDATABASE: "database",
		OLLAMA_MODEL: "ai", WEBUI_API_KEY: "ai", WEBUI_CHAT_ENDPOINT: "ai", EMBEDDING_MODEL: "memory", EMBEDDING_ENDPOINT: "memory" };
	for (const variable of Object.keys(validEnvironment)) {
		for (const value of [undefined, "", "   "]) {
			const environment = { ...validEnvironment, [variable]: value };
			if (variable === "TOKEN") {assert.throws(() => validateEnvironment(environment), /TOKEN is required/);}
			else {
				assert.doesNotThrow(() => validateEnvironment(environment));
				const feature = getFeatureConfiguration(environment)[owners[variable]];
				assert.equal(feature.enabled, false);
				assert.ok(feature.problems.includes(`${variable} is missing`));
			}
		}
	}
});

test("malformed optional settings disable features and log variable names without values", () => {
	const invalidValues = {
		PGPORT: ["0", "65536", "5432junk", "5.5", " 5432", "1e3"],
		CONTEXT_RECENT_COUNT: ["", "-1", "2.5", "8messages", "2147483648"],
		CONTEXT_SIMILAR_COUNT: ["", "-1", "2.5", "3messages", "2147483648"],
		GUILD_ID: ["0", "guild-id", "1.5"],
		GENERAL_CHAT_ID: ["0", "channel-id", "-12"],
		WEBUI_CHAT_ENDPOINT: ["/api/chat/completions", "ftp://example.invalid", "secret-key"],
		EMBEDDING_ENDPOINT: ["not-a-url", "file:///private/path", "secret-key"],
		LLM_ENABLED: ["", "TRUE", "yes", "1"],
		SOCIAL_MEDIA_ENABLED: ["", "TRUE", "yes", "1"],
		LOG_LEVEL: ["", "verbose", "secret-key"],
		BIRTHDAY_TIMEZONE: ["", "Europe/Not-A-Zone", "secret-key", " Europe/Brussels "],
	};
	for (const [variable, values] of Object.entries(invalidValues)) {
		for (const value of values) {
			const environment = { ...validEnvironment, [variable]: value };
			assert.doesNotThrow(() => validateEnvironment(environment));
			const logs = [];
			logFeatureConfiguration({ info: (...args) => logs.push(args.join(" ")), warn: (...args) => logs.push(args.join(" ")) }, environment);
			assert.ok(logs.some((line) => line.includes(`${variable} must be`)), variable);
			assert.ok(!logs.join(" ").includes("secret-key"));
		}
	}
	assert.throws(() => validateEnvironment({}), /TOKEN is required/);
});

test("enabled social worker requires a bounded local socket path", () => {
	assert.doesNotThrow(() => validateEnvironment({ ...validEnvironment, SOCIAL_MEDIA_ENABLED: "true", SOCIAL_WORKER_SOCKET: "/tmp/worker.sock" }));
	for (const value of [undefined, "", "relative.sock", "https://example.test", "/".repeat(101), "/tmp/bad\nsock"]) {
		const configuration = getFeatureConfiguration({ ...validEnvironment, SOCIAL_MEDIA_ENABLED: "true", SOCIAL_WORKER_SOCKET: value });
		assert.equal(configuration.socialMedia.enabled, false);
		assert.ok(configuration.socialMedia.problems.some((problem) => problem.startsWith("SOCIAL_WORKER_SOCKET")));
	}
});

test("social runtime starts after login and drains before Discord and PostgreSQL close", async () => {
	const { startBot } = await import("../main.ts");
	const { socialRuntimes } = await import("../core/socialRuntime.ts");
	const calls = [];
	const client = { destroy: async () => { calls.push("destroy"); } };
	const runtime = {
		start: () => { calls.push("start social"); },
		stop: async () => { calls.push("stop social"); },
	};
	const bot = await startBot({
		validateEnvironment: () => undefined, createClient: () => client, createSocialRuntime: () => runtime,
		createPGPool: async () => undefined, closeDatabase: async () => { calls.push("close database"); },
		commandHandler: async () => undefined, eventHandler: async () => undefined, drainEvents: async () => undefined,
		loginClient: async () => { calls.push("login"); }, startCronJobs: () => async () => undefined,
		logger: { info: () => undefined, error: () => undefined },
	});
	assert.equal(socialRuntimes.get(client), runtime);
	await bot.stop();
	await bot.stop();
	assert.equal(socialRuntimes.has(client), false);
	assert.deepEqual(calls, ["login", "start social", "stop social", "destroy", "close database"]);
});

test("invalid configuration rejects before creating clients, connecting, scheduling, or logging in", async () => {
	const { startBot } = await import("../main.ts");
	const calls = [];
	const errors = [];
	const recordCall = () => calls.push("unexpected service call");
	await assert.rejects(startBot({
		commandHandler: recordCall,
		createClient: recordCall,
		createPGPool: recordCall,
		eventHandler: recordCall,
		loginClient: recordCall,
		logger: {
			info: recordCall,
			error: (...args) => errors.push(args),
		},
		startCronJobs: recordCall,
		validateEnvironment: () => validateEnvironment({}),
	}), /Invalid environment configuration/);
	assert.deepEqual(calls, []);
	assert.equal(errors.length, 1);
	assert.match(errors[0][1].message, /TOKEN is required/);
});
