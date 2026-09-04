import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "discord.js";

async function createFixtureRoot(prefix) {
	return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("command loader imports only the current .ts runtime extension", async () => {
	const commandsRoot = await createFixtureRoot("caitlyn-commands-");
	const categoryRoot = path.join(commandsRoot, "utility");
	await mkdir(categoryRoot);

	try {
		await writeFile(path.join(categoryRoot, "typescript-command.ts"), [
			"export const category = \"utility\";",
			"export const data = { name: \"typescript-command\", toJSON() { return { name: this.name }; } };",
			"export async function execute() { return undefined; }",
			"",
		].join("\n"));
		await writeFile(path.join(categoryRoot, "javascript-command.js"), [
			"export const category = \"utility\";",
			"export const data = { name: \"javascript-command\", toJSON() { return { name: this.name }; } };",
			"export async function execute() { return undefined; }",
			"",
		].join("\n"));

		const { commandHandler } = await import("../handlers/commandHandler.ts");
		const client = new Client({ intents: [] });
		await commandHandler(client, commandsRoot);

		assert.deepEqual([...client.commands.keys()], ["typescript-command"]);
	}
	finally {
		await rm(commandsRoot, { force: true, recursive: true });
	}
});

test("event loader imports only the current .ts runtime extension", async () => {
	const eventsRoot = await createFixtureRoot("caitlyn-events-");

	try {
		await writeFile(path.join(eventsRoot, "typescript-event.ts"), [
			"export const name = \"error\";",
			"export function execute() { return undefined; }",
			"",
		].join("\n"));
		await writeFile(path.join(eventsRoot, "javascript-event.js"), [
			"export const name = \"ready\";",
			"export function execute() { return undefined; }",
			"",
		].join("\n"));

		const { eventHandler } = await import("../handlers/eventHandler.ts");
		const client = new Client({ intents: [] });
		await eventHandler(client, eventsRoot);

		assert.equal(client.listenerCount("error"), 1);
		assert.equal(client.listenerCount("ready"), 0);
	}
	finally {
		await rm(eventsRoot, { force: true, recursive: true });
	}
});
