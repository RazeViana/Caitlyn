import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayIntentBits } from "discord.js";

test("startup preserves initialization order and required Discord intents", async () => {
	const originalToken = process.env.TOKEN;
	const processEvents = ["uncaughtException", "unhandledRejection", "SIGTERM", "SIGINT"];
	const listenerCounts = new Map(processEvents.map((event) => [event, process.listenerCount(event)]));
	process.env.TOKEN = "startup-test-token";

	try {
		const { startBot } = await import("../main.ts");
		const calls = [];
		const client = {};
		let receivedIntents;

		await startBot({
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
			loginClient: (receivedClient) => {
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
			},
		});

		assert.deepEqual(calls, [
			"create client",
			"initialize PostgreSQL",
			"load commands",
			"load events",
			"start cron jobs",
			"log in",
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
	const validEnvironment = {
		CLIENT_ID: "client-id",
		GUILD_ID: "guild-id",
		TOKEN: "token",
	};

	for (const variable of Object.keys(validEnvironment)) {
		const environment = { ...validEnvironment };
		delete environment[variable];
		await assert.rejects(
			deployCommands(environment),
			new RegExp(`No ${variable} found`),
		);
	}
});
