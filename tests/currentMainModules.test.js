import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const expectedCommands = [
	"activity",
	"addbirthday",
	"leaderboard",
	"ping",
	"reload",
	"removebirthday",
	"server",
	"showbirthdays",
	"streaks",
	"toggleai",
	"user",
];
const expectedEvents = ["interactionCreate", "messageCreate", "ready", "voiceStateUpdate"];

async function exportedNames(root) {
	const files = fs.readdirSync(root).filter((file) => file.endsWith(".js"));
	return Promise.all(files.map(async (file) => {
		const module = await import(pathToFileURL(path.join(root, file)).href);
		return module.data?.name ?? path.basename(file, ".js");
	}));
}

test("current main exposes every command and event before conversion", async () => {
	const commandFolders = ["commands/user", "commands/utility"];
	const commands = (await Promise.all(commandFolders.map(exportedNames))).flat().sort();
	const events = (await exportedNames("events")).sort();
	assert.deepEqual(commands, expectedCommands);
	assert.deepEqual(events, expectedEvents);
});
