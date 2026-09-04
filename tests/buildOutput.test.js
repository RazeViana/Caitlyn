import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const expectedFiles = [
	"dist/main.js",
	"dist/core/deployCommands.js",
	"dist/events/interactionCreate.js",
	"dist/events/messageCreate.js",
	"dist/events/ready.js",
	"dist/events/voiceStateUpdate.js",
	"dist/commands/user/activity.js",
	"dist/commands/user/addbirthday.js",
	"dist/commands/user/removebirthday.js",
	"dist/commands/user/showbirthdays.js",
	"dist/commands/utility/leaderboard.js",
	"dist/commands/utility/ping.js",
	"dist/commands/utility/reload.js",
	"dist/commands/utility/server.js",
	"dist/commands/utility/streaks.js",
	"dist/commands/utility/toggleai.js",
	"dist/commands/utility/user.js",
];

test("clean production build emits every runtime entry point", () => {
	const missingFiles = expectedFiles.filter((file) => {
		return !fs.existsSync(path.join(repositoryRoot, file));
	});

	assert.deepEqual(missingFiles, []);
	assert.equal(fs.existsSync(path.join(repositoryRoot, "dist/stale.js")), false);
});

test("emitted ESM entry points load without starting the bot", async () => {
	const mainModule = await import(pathToFileURL(path.join(repositoryRoot, "dist/main.js")).href);
	const commandModule = await import(pathToFileURL(path.join(repositoryRoot, "dist/commands/utility/ping.js")).href);
	const eventModule = await import(pathToFileURL(path.join(repositoryRoot, "dist/events/ready.js")).href);

	assert.equal(typeof mainModule.startBot, "function");
	assert.equal(commandModule.data.name, "ping");
	assert.equal(eventModule.name, "clientReady");
});
