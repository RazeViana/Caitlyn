const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const expectedFiles = [
	"dist/main.js",
	"dist/core/deployCommands.js",
	"dist/events/interactionCreate.js",
	"dist/events/messageCreate.js",
	"dist/events/ready.js",
	"dist/commands/user/addbirthday.js",
	"dist/commands/user/removebirthday.js",
	"dist/commands/user/showbirthdays.js",
	"dist/commands/utility/ping.js",
	"dist/commands/utility/reload.js",
	"dist/commands/utility/server.js",
	"dist/commands/utility/user.js",
];

test("build emits the entry point and all dynamic modules", () => {
	for (const file of expectedFiles) {
		assert.equal(
			fs.existsSync(path.resolve(file)),
			true,
			`${file} should exist`,
		);
	}
});
