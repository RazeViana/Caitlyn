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
import { validateEnvironment } from "../core/environment.ts";

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
		LOG_LEVEL: "warn",
		CONTEXT_RECENT_COUNT: "0",
		CONTEXT_SIMILAR_COUNT: "3",
	}));
});

test("startup requires every bot setting, including AI settings for runtime toggling", () => {
	for (const variable of Object.keys(validEnvironment)) {
		for (const value of [undefined, "", "   "]) {
			assert.throws(
				() => validateEnvironment({ ...validEnvironment, LLM_ENABLED: "false", [variable]: value }),
				new RegExp(`${variable} is required`),
			);
		}
	}
});

test("startup rejects malformed ports, context counts, IDs, URLs, and switches without disclosing values", () => {
	const invalidValues = {
		PGPORT: ["0", "65536", "5432junk", "5.5", " 5432", "1e3"],
		CONTEXT_RECENT_COUNT: ["", "-1", "2.5", "8messages", "2147483648"],
		CONTEXT_SIMILAR_COUNT: ["", "-1", "2.5", "3messages", "2147483648"],
		GUILD_ID: ["0", "guild-id", "1.5"],
		GENERAL_CHAT_ID: ["0", "channel-id", "-12"],
		WEBUI_CHAT_ENDPOINT: ["/api/chat/completions", "ftp://example.invalid", "secret-key"],
		EMBEDDING_ENDPOINT: ["not-a-url", "file:///private/path", "secret-key"],
		LLM_ENABLED: ["", "TRUE", "yes", "1"],
		LOG_LEVEL: ["", "verbose", "secret-key"],
	};
	for (const [variable, values] of Object.entries(invalidValues)) {
		for (const value of values) {
			assert.throws(
				() => validateEnvironment({ ...validEnvironment, [variable]: value }),
				(error) => error.message.includes(`${variable} must be`) && !error.message.includes("secret-key"),
			);
		}
	}
	assert.throws(() => validateEnvironment({}), (error) => {
		return Object.keys(validEnvironment).every((variable) => error.message.includes(`${variable} is required`));
	});
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
