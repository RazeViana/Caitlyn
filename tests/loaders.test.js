const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Client } = require("discord.js");

const { commandHandler } = require("../handlers/commandHandler.ts");
const { eventHandler } = require("../handlers/eventHandler.ts");

test("loads every TypeScript command module", () => {
	const client = new Client({ intents: [] });

	commandHandler(client);

	assert.equal(client.commands.size, 7);
});

test("registers every TypeScript event module", () => {
	const client = new Client({ intents: [] });

	eventHandler(client);

	assert.equal(client.listenerCount("interactionCreate"), 1);
	assert.equal(client.listenerCount("messageCreate"), 1);
	assert.equal(client.listenerCount("ready"), 1);
});
