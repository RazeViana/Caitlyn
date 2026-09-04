import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageFlags } from "discord.js";

const pingCommand = await import("../commands/utility/ping.ts");
const reloadCommand = await import("../commands/utility/reload.ts");
const serverCommand = await import("../commands/utility/server.ts");
const userCommand = await import("../commands/utility/user.ts");

test("utility commands preserve metadata and reply copy", async () => {
	const commandCases = [
		{
			command: pingCommand,
			description: "Replies with Pong!",
			interaction: {},
			name: "ping",
			reply: "Pong",
		},
		{
			command: serverCommand,
			description: "Provides information about the server.",
			interaction: { guild: { memberCount: 42, name: "Test Guild" } },
			name: "server",
			reply: "This server is Test Guild and has 42 members.",
		},
		{
			command: userCommand,
			description: "Provides information about the user.",
			interaction: {
				member: { joinedAt: { toString: () => "JOINED_AT" } },
				user: { username: "Alice" },
			},
			name: "user",
			reply: "This command was run by Alice, who joined on JOINED_AT.",
		},
	];

	for (const commandCase of commandCases) {
		const replies = [];
		await commandCase.command.execute({
			...commandCase.interaction,
			reply: async (response) => {
				replies.push(response);
			},
		});

		assert.equal(commandCase.command.cooldown, 5);
		assert.equal(commandCase.command.category, "utility");
		const metadata = commandCase.command.data.toJSON();
		assert.equal(metadata.name, commandCase.name);
		assert.equal(metadata.description, commandCase.description);
		assert.deepEqual(replies, [commandCase.reply]);
	}

	assert.equal(reloadCommand.category, "utility");
	assert.equal("cooldown" in reloadCommand, false);
	const reloadMetadata = reloadCommand.data.toJSON();
	assert.equal(reloadMetadata.name, "reload");
	assert.equal(reloadMetadata.description, "Reloads a command.");
	assert.equal(reloadMetadata.options.length, 1);
	assert.deepEqual({
		autocomplete: reloadMetadata.options[0].autocomplete,
		description: reloadMetadata.options[0].description,
		name: reloadMetadata.options[0].name,
		required: reloadMetadata.options[0].required,
		type: reloadMetadata.options[0].type,
	}, {
		autocomplete: true,
		description: "The command to reload.",
		name: "command",
		required: true,
		type: 3,
	});
});

test("reload lowercases the selection and replaces it through a cache-busted source URL", async () => {
	const oldCommand = {
		category: "utility",
		data: pingCommand.data,
		execute: pingCommand.execute,
	};
	const replacement = {
		category: "utility",
		data: pingCommand.data,
		execute: async () => undefined,
	};
	const commands = new Map([["ping", oldCommand]]);
	const importedURLs = [];
	const replies = [];

	await reloadCommand.execute({
		client: { commands },
		options: { getString: () => "PiNg" },
		reply: async (response) => {
			replies.push(response);
		},
	}, {
		importModule: async (url) => {
			importedURLs.push(url);
			return replacement;
		},
		now: () => 1788541200000,
	});

	assert.equal(importedURLs.length, 1);
	const importedURL = new URL(importedURLs[0]);
	assert.match(importedURL.pathname, /\/commands\/utility\/ping\.ts$/);
	assert.equal(importedURL.searchParams.get("update"), "1788541200000");
	assert.equal(commands.get("ping"), replacement);
	assert.deepEqual(replies, ["Command `/ping` was reloaded!"]);
});

test("reload preserves missing-command and missing-category ephemeral replies", async () => {
	const missingReplies = [];
	await reloadCommand.execute({
		client: { commands: new Map() },
		options: { getString: () => "MISSING" },
		reply: async (response) => {
			missingReplies.push(response);
		},
	});
	assert.deepEqual(missingReplies, [{
		content: "There is no command with name `/missing`",
		flags: MessageFlags.Ephemeral,
	}]);

	const malformedReplies = [];
	const malformed = {
		category: "",
		data: { name: "broken" },
		execute: async () => undefined,
	};
	await reloadCommand.execute({
		client: { commands: new Map([["broken", malformed]]) },
		options: { getString: () => "broken" },
		reply: async (response) => {
			malformedReplies.push(response);
		},
	});
	assert.deepEqual(malformedReplies, [{
		content: "Command missing category, sort it out mate",
		flags: MessageFlags.Ephemeral,
	}]);
});

test("reload autocomplete keeps case-sensitive filtering and caps choices at 25", async () => {
	const commandNames = [
		"ping",
		"Pong",
		...Array.from({ length: 30 }, (_, index) => `Prefix${String(index).padStart(2, "0")}`),
	];
	const responses = [];

	await reloadCommand.autocomplete({
		client: { commands: new Map(commandNames.map((name) => [name, {}])) },
		options: { getFocused: () => "P" },
		respond: async (choices) => {
			responses.push(choices);
		},
	});

	assert.equal(responses.length, 1);
	assert.equal(responses[0].length, 25);
	assert.deepEqual(responses[0].slice(0, 3), [
		{ name: "Pong", value: "Pong" },
		{ name: "Prefix00", value: "Prefix00" },
		{ name: "Prefix01", value: "Prefix01" },
	]);
	assert.equal(responses[0].some(({ name }) => name === "ping"), false);
});
