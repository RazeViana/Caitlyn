const assert = require("node:assert/strict");
const { test } = require("node:test");

const ping = require("../commands/utility/ping.ts");
const reload = require("../commands/utility/reload.ts");
const server = require("../commands/utility/server.ts");
const user = require("../commands/utility/user.ts");

test("preserves utility slash command names", () => {
	assert.equal(ping.data.name, "ping");
	assert.equal(reload.data.name, "reload");
	assert.equal(server.data.name, "server");
	assert.equal(user.data.name, "user");
});

test("reload replaces the requested non-reload command from its module", async () => {
	const previousPing = { ...ping };
	const commands = new Map([
		["ping", previousPing],
		["reload", reload],
	]);
	let reply;

	await reload.execute({
		options: {
			getString: () => "ping",
		},
		client: { commands },
		reply: async (message) => {
			reply = message;
		},
	});

	assert.equal(commands.get("ping").data.name, "ping");
	assert.notEqual(commands.get("ping"), previousPing);
	assert.equal(commands.get("reload"), reload);
	assert.equal(reply, "Command `/ping` was reloaded!");
});
