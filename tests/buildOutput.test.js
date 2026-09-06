/**
 * @file buildOutput.test.js
 * @description Verifies the compiled ESM tree, import safety, and runtime module discovery.
 * Checks startup and deployment failures without credentials or live service access.
 *
 * @module buildOutput.test
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const expectedFiles = [
	"dist/main.js",
	"dist/core/deployCommands.js",
	"dist/core/environment.js",
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
	const originalToken = process.env.TOKEN;
	process.env.TOKEN = "test-token";

	try {
		const mainModule = await import(pathToFileURL(path.join(repositoryRoot, "dist/main.js")).href);
		const commandModule = await import(pathToFileURL(path.join(repositoryRoot, "dist/commands/utility/ping.js")).href);
		const eventModule = await import(pathToFileURL(path.join(repositoryRoot, "dist/events/ready.js")).href);

		assert.equal(typeof mainModule.startBot, "function");
		assert.equal(commandModule.data.name, "ping");
		assert.equal(eventModule.name, "clientReady");
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

test("compiled startup imports without secrets and reports missing configuration before connecting", async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-invalid-startup-"));
	const moduleUrl = pathToFileURL(path.join(repositoryRoot, "dist/main.js")).href;
	const childEnvironment = {};
	for (const name of ["SystemRoot", "WINDIR"]) {
		if (process.env[name] !== undefined) childEnvironment[name] = process.env[name];
	}

	try {
		const child = spawnSync(process.execPath, [
			"--input-type=module",
			"--eval",
			`const { startBot } = await import(${JSON.stringify(moduleUrl)});
			process.stdout.write("imported safely\\n");
			await startBot();`,
		], {
			cwd: temporaryDirectory,
			encoding: "utf8",
			env: childEnvironment,
			timeout: 10000,
		});

		assert.equal(child.status, 1, child.stderr);
		assert.equal(child.signal, null);
		assert.equal(child.stdout, "imported safely\n");
		for (const variable of ["TOKEN", "PGHOST", "GUILD_ID", "WEBUI_API_KEY", "EMBEDDING_ENDPOINT"]) {
			assert.match(child.stderr, new RegExp(`${variable} is required`));
		}
	}
	finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
});

test("compiled command deployment exits unsuccessfully when configuration is missing", async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-invalid-deployment-"));
	const childEnvironment = {};
	for (const name of ["SystemRoot", "WINDIR"]) {
		if (process.env[name] !== undefined) childEnvironment[name] = process.env[name];
	}

	try {
		const child = spawnSync(process.execPath, [
			path.join(repositoryRoot, "dist/core/deployCommands.js"),
		], {
			cwd: temporaryDirectory,
			encoding: "utf8",
			env: childEnvironment,
			timeout: 10000,
		});
		assert.equal(child.status, 1, child.stderr);
		assert.equal(child.signal, null);
		assert.equal(child.stdout, "");
		assert.match(child.stderr, /No CLIENT_ID found/);
	}
	finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
});

test("compiled handlers and deployment discover every production command and event from their default roots", async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-compiled-runtime-"));
	const commandHandlerUrl = pathToFileURL(
		path.join(repositoryRoot, "dist/handlers/commandHandler.js"),
	).href;
	const eventHandlerUrl = pathToFileURL(
		path.join(repositoryRoot, "dist/handlers/eventHandler.js"),
	).href;
	const deployCommandsUrl = pathToFileURL(
		path.join(repositoryRoot, "dist/core/deployCommands.js"),
	).href;
	const script = `
		const { default: fs } = await import("node:fs");
		const originalReaddir = fs.readdirSync;
		fs.readdirSync = (...args) => originalReaddir(...args).reverse();
		const environmentNames = ["TOKEN", "CLIENT_ID", "GUILD_ID"];
		const originalEnvironment = Object.fromEntries(
			environmentNames.map((name) => [name, process.env[name]]),
		);
		const ignoredLogs = [];
		console.log = (...args) => ignoredLogs.push(args);
		console.warn = (...args) => ignoredLogs.push(args);
		console.error = (...args) => ignoredLogs.push(args);
		let result;
		try {
			process.env.TOKEN = "compiled-token";
			process.env.CLIENT_ID = "compiled-client-id";
			process.env.GUILD_ID = "compiled-guild-id";
			const { commandHandler } = await import(${JSON.stringify(commandHandlerUrl)});
			const { eventHandler } = await import(${JSON.stringify(eventHandlerUrl)});
			const { deployCommands } = await import(${JSON.stringify(deployCommandsUrl)});
			const listeners = [];
			const client = {
				on: (name, listener) => listeners.push({ method: "on", name, listener }),
				once: (name, listener) => listeners.push({ method: "once", name, listener }),
			};
			await commandHandler(client);
			await eventHandler(client);
			const restCalls = [];
			const rest = {
				put: async (route, options) => {
					restCalls.push({ route, options });
					return options.body;
				},
			};
			await deployCommands(undefined, { rest });
			result = {
				commandNames: [...client.commands.keys()].sort(),
				listeners: listeners.map(({ method, name }) => ({ method, name })),
				restCalls,
			};
		}
		finally {
			fs.readdirSync = originalReaddir;
			for (const name of environmentNames) {
				if (originalEnvironment[name] === undefined) delete process.env[name];
				else process.env[name] = originalEnvironment[name];
			}
		}
		process.stdout.write(JSON.stringify(result));
	`;
	const childEnvironment = {};
	for (const name of ["SystemRoot", "WINDIR"]) {
		if (process.env[name] !== undefined) childEnvironment[name] = process.env[name];
	}

	try {
		const child = spawnSync(process.execPath, [
			"--input-type=module",
			"--eval",
			script,
		], {
			cwd: temporaryDirectory,
			encoding: "utf8",
			env: childEnvironment,
		});

		assert.equal(child.status, 0, child.stderr);
		const result = JSON.parse(child.stdout);
		assert.deepEqual(result.commandNames, [
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
		]);
		assert.deepEqual(result.listeners.toSorted((a, b) => a.name.localeCompare(b.name)), [
			{ method: "once", name: "clientReady" },
			{ method: "on", name: "interactionCreate" },
			{ method: "on", name: "messageCreate" },
			{ method: "on", name: "voiceStateUpdate" },
		]);
		assert.equal(result.restCalls.length, 1);
		assert.equal(
			result.restCalls[0].route,
			"/applications/compiled-client-id/guilds/compiled-guild-id/commands",
		);
		const guildPayload = result.restCalls[0].options.body;
		assert.equal(guildPayload.length, 11);
		assert.equal(guildPayload.every((command) => {
			return command !== null && typeof command === "object" && !Array.isArray(command);
		}), true);
		assert.deepEqual(guildPayload.map(({ name }) => name).sort(), [
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
		]);
	}
	finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
});
