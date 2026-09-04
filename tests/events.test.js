import assert from "node:assert/strict";
import { test } from "node:test";
import { Events } from "discord.js";

const interactionCreate = await import("../events/interactionCreate.ts");
const messageCreate = await import("../events/messageCreate.ts");
const ready = await import("../events/ready.ts");
const voiceStateUpdate = await import("../events/voiceStateUpdate.ts");

function deferred() {
	let resolve;
	const promise = new Promise((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

test("voice moves record leave before join while bot users are ignored", async () => {
	const calls = [];
	const leaveGate = deferred();
	const member = {
		id: "user-id",
		user: {
			bot: false,
			username: "Alice",
		},
	};
	const oldState = {
		channel: { id: "old-channel", name: "Old room" },
	};
	const newState = {
		channel: { id: "new-channel", name: "New room" },
		guild: { id: "guild-id" },
		member,
	};
	const dependencies = {
		logger: {
			debug: () => undefined,
			error: () => undefined,
		},
		trackVoiceJoin: async (...args) => {
			calls.push(["join", ...args]);
		},
		trackVoiceLeave: (...args) => {
			calls.push(["leave", ...args]);
			return leaveGate.promise;
		},
	};
	const operation = voiceStateUpdate.execute(oldState, newState, dependencies);

	assert.deepEqual(calls, [["leave", "guild-id", "user-id", "Alice"]]);
	leaveGate.resolve();
	await operation;
	assert.deepEqual(calls, [
		["leave", "guild-id", "user-id", "Alice"],
		["join", "guild-id", "user-id", "Alice", "new-channel", "New room"],
	]);

	calls.length = 0;
	member.user.bot = true;
	await voiceStateUpdate.execute(oldState, newState, dependencies);
	assert.deepEqual(calls, []);
});

test("interaction dispatch preserves autocomplete and command error responses", async () => {
	let autocompleteCalls = 0;
	const autocompleteCommand = {
		autocomplete: async () => {
			autocompleteCalls += 1;
		},
	};
	await interactionCreate.execute({
		client: { commands: new Map([["search", autocompleteCommand]]) },
		commandName: "search",
		isAutocomplete: () => true,
		isChatInputCommand: () => false,
	});
	assert.equal(autocompleteCalls, 1);

	const originalConsoleError = console.error;
	const errors = [];
	console.error = (...args) => {
		errors.push(args.join(" "));
	};
	try {
		await interactionCreate.execute({
			client: {
				commands: new Map([["explode", {
					category: "utility",
					cooldown: 0,
					data: { name: "explode" },
					execute: async () => {
						throw new Error("command failed");
					},
				}]]),
			},
			commandName: "explode",
			isAutocomplete: () => false,
			isChatInputCommand: () => true,
			reply: async () => undefined,
			user: { id: "user-id" },
		});
	}
	finally {
		console.error = originalConsoleError;
	}

	assert.equal(errors.length, 1);
	assert.match(errors[0], /Error executing explode:.*command failed/s);
});

test("autocomplete errors are logged and swallowed without interaction responses", async () => {
	const originalConsoleError = console.error;
	const errors = [];
	const responses = [];
	const failure = new Error("autocomplete failed");
	console.error = (...args) => {
		errors.push(args.join(" "));
	};

	try {
		await assert.doesNotReject(() => interactionCreate.execute({
			client: {
				commands: new Map([["search", {
					autocomplete: async () => {
						throw failure;
					},
				}]]),
			},
			commandName: "search",
			isAutocomplete: () => true,
			isChatInputCommand: () => false,
			reply: async (response) => {
				responses.push(["reply", response]);
			},
			respond: async (response) => {
				responses.push(["respond", response]);
			},
		}));
	}
	finally {
		console.error = originalConsoleError;
	}

	assert.equal(errors.length, 1);
	assert.match(errors[0], /Error in autocomplete for search:.*autocomplete failed/s);
	assert.deepEqual(responses, []);
});

test("event metadata and ready behavior remain compatible with Discord", async () => {
	assert.equal(interactionCreate.name, Events.InteractionCreate);
	assert.equal(messageCreate.name, Events.MessageCreate);
	assert.equal(ready.name, Events.ClientReady);
	assert.equal(ready.once, true);
	assert.equal(voiceStateUpdate.name, Events.VoiceStateUpdate);

	const originalConsoleLog = console.log;
	const logs = [];
	console.log = (...args) => {
		logs.push(args.join(" "));
	};
	try {
		ready.execute({ user: { username: "Caitlyn" } });
	}
	finally {
		console.log = originalConsoleLog;
	}
	assert.equal(logs.length, 1);
	assert.match(logs[0], /Caitlyn is online/);
});
