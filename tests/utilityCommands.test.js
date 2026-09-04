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
