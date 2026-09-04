const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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

test("loads events matching the runtime module extension only", () => {
	const client = new Client({ intents: [] });
	const fixtureRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "caitlyn-events-"),
	);

	try {
		fs.writeFileSync(
			path.join(fixtureRoot, "runtime-extension-fixture.ts"),
			[
				"export = {",
				"\tname: \"error\",",
				"\texecute() { return undefined; },",
				"};",
				"",
			].join("\n"),
		);
		fs.writeFileSync(
			path.join(fixtureRoot, "other-extension-fixture.js"),
			"module.exports = { name: \"ready\", execute() { return undefined; } };\n",
		);

		eventHandler(client, fixtureRoot);

		assert.equal(client.listenerCount("error"), 1);
		assert.equal(client.listenerCount("ready"), 0);
	}
	finally {
		fs.rmSync(fixtureRoot, { recursive: true, force: true });
	}
});
