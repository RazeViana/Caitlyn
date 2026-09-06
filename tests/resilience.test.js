/**
 * @file resilience.test.js
 * @description Tests application failure boundaries, service deadlines, and graceful cleanup.
 * Covers transactions, command responses, AI degradation, and safe reload with isolated fixtures.
 *
 * @module resilience.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Collection, MessageFlags } from "discord.js";
import { startBot } from "../main.ts";
import { pool, createPGPool } from "../core/createPGPool.ts";
import { createClient } from "../core/createClient.ts";
import logger from "../core/logger.ts";
import { respondWithError } from "../core/interactionResponse.ts";
import { execute as interactionCreate } from "../events/interactionCreate.ts";
import { execute as messageCreate } from "../events/messageCreate.ts";
import { withTransaction } from "../core/transaction.ts";
import { withTimeout } from "../core/asyncTools.ts";
import { messageChunks } from "../core/textLimits.ts";
import { caitlynAI } from "../messages/caitlynAI.ts";
import { chat } from "../core/ollama.ts";
import { generateEmbedding } from "../core/embeddingService.ts";
import { getConversationContext } from "../core/messageStore.ts";
import { execute as reload } from "../commands/utility/reload.ts";
import { eventHandler, drainEvents } from "../handlers/eventHandler.ts";
import { startBirthdayScheduledEvent } from "../jobs/birthdayScheduledEvent.ts";
import { execute as activityCommand } from "../commands/user/activity.ts";
import { execute as leaderboardCommand } from "../commands/utility/leaderboard.ts";
import { execute as streaksCommand } from "../commands/utility/streaks.ts";

function silence(context) {
	for (const level of ["error", "warn", "info", "success", "debug"]) context.mock.method(logger, level, () => undefined);
}

function startupFixture() {
	const calls = [];
	const dependencies = {
		validateEnvironment: () => undefined,
		createClient: () => ({ destroy: async () => { calls.push("destroy"); } }),
		createPGPool: async () => { calls.push("database"); },
		closeDatabase: async () => { calls.push("close database"); },
		commandHandler: async () => { calls.push("commands"); },
		eventHandler: async () => { calls.push("events"); },
		drainEvents: async () => { calls.push("drain"); },
		loginClient: async () => { calls.push("login"); },
		startCronJobs: () => {
			calls.push("jobs");
			return async () => { calls.push("stop jobs"); };
		},
		logger: { info: (message) => { calls.push(message); }, error: () => undefined },
	};
	return { calls, dependencies };
}

test("startup DB/login failures clean up and never schedule jobs or claim success", async () => {
	for (const failurePoint of ["createPGPool", "loginClient"]) {
		const { calls, dependencies } = startupFixture();
		dependencies[failurePoint] = async () => { throw new Error("unavailable"); };
		await assert.rejects(startBot(dependencies), /unavailable/);
		assert.ok(!calls.includes("jobs"));
		assert.ok(!calls.includes("Bot started successfully"));
		assert.ok(calls.includes("destroy"));
		assert.ok(calls.includes("close database"));
	}
});

test("startup awaits login and shutdown drains resources exactly once", async () => {
	const { calls, dependencies } = startupFixture();
	let ready;
	dependencies.loginClient = () => new Promise((resolve) => { ready = resolve; });
	const starting = startBot(dependencies);
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(!calls.includes("jobs"));
	ready();
	const runtime = await starting;
	assert.ok(calls.includes("Bot started successfully"));
	await Promise.all([runtime.stop(), runtime.stop()]);
	for (const step of ["stop jobs", "drain", "destroy", "close database"]) {
		assert.equal(calls.filter((call) => call === step).length, 1);
	}
	assert.ok(calls.indexOf("drain") < calls.indexOf("close database"));
});

test("shutdown still closes the pool when Discord cleanup fails", async () => {
	const { calls, dependencies } = startupFixture();
	dependencies.createClient = () => ({ destroy: async () => { throw new Error("destroy failed"); } });
	const runtime = await startBot(dependencies);
	await runtime.stop();
	assert.ok(calls.includes("close database"));
});

test("database startup retries transient errors but not invalid credentials", async (context) => {
	silence(context);
	let attempts = 0;
	const waits = [];
	context.mock.method(pool, "query", async () => {
		attempts++;
		throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
	});
	await assert.rejects(createPGPool(async (duration) => { waits.push(duration); }), /refused/);
	assert.equal(attempts, 3);
	assert.deepEqual(waits, [1_000, 2_000]);
	attempts = 0;
	context.mock.method(pool, "query", async () => {
		attempts++;
		throw Object.assign(new Error("invalid credentials"), { code: "28P01" });
	});
	await assert.rejects(createPGPool(), /invalid credentials/);
	assert.equal(attempts, 1);
	assert.equal(pool.options.connectionTimeoutMillis, 5_000);
	assert.equal(pool.options.statement_timeout, 10_000);
	assert.equal(pool.options.query_timeout, 15_000);
});

test("pool, client, and message errors are contained", async (context) => {
	silence(context);
	assert.doesNotThrow(() => pool.emit("error", new Error("lost connection")));
	const client = createClient([]);
	try {
		assert.doesNotThrow(() => client.emit("error", new Error("gateway failure")));
		await assert.doesNotReject(messageCreate({ author: { bot: false } }, async () => { throw new Error("handler rejected"); }));
	}
	finally {
		await client.destroy();
	}
});

test("registered event failures are caught and shutdown waits for accepted work", async (context) => {
	silence(context);
	const directory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-event-failure-"));
	const client = createClient([]);
	const errors = [];
	context.mock.method(logger, "error", (...args) => { errors.push(args); });
	try {
		await writeFile(path.join(directory, "work.ts"), "export const name = 'debug'; export async function execute(work) { await work(); }\n");
		await eventHandler(client, directory);
		let release;
		client.emit("debug", () => new Promise((resolve) => { release = resolve; }));
		client.emit("debug", async () => { throw new Error("handler failed"); });
		let drained = false;
		const draining = drainEvents(client).then(() => { drained = true; });
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(drained, false);
		client.emit("debug", () => assert.fail("new work accepted during shutdown"));
		release();
		await draining;
		assert.equal(errors.length, 1);
		assert.match(errors[0][0], /Discord event debug/);
	}
	finally {
		await client.destroy();
		await rm(directory, { recursive: true, force: true });
	}
});

test("cron jobs do not overlap and their shutdown awaits an active reminder", async () => {
	let callback;
	let finish;
	let reminders = 0;
	let destroyed = false;
	const stop = startBirthdayScheduledEvent({}, {
		info: () => undefined,
		schedule: (_expression, scheduled, options) => {
			assert.equal(options.noOverlap, true);
			callback = scheduled;
			return { destroy: async () => { destroyed = true; } };
		},
		birthdayReminderMessage: () => {
			reminders++;
			return new Promise((resolve) => { finish = resolve; });
		},
	});
	const running = callback();
	await callback();
	assert.equal(reminders, 1);
	let stopped = false;
	const stopping = stop().then(() => { stopped = true; });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(destroyed, true);
	assert.equal(stopped, false);
	finish();
	await running;
	await stopping;
	await callback();
	assert.equal(reminders, 1);
});

test("safe errors use reply, edit, or follow-up and tolerate expired interactions", async (context) => {
	silence(context);
	for (const state of ["new", "deferred", "replied"]) {
		const calls = [];
		const interaction = {
			deferred: state === "deferred", replied: state === "replied",
			reply: async (payload) => { calls.push(["reply", payload]); },
			editReply: async (payload) => { calls.push(["edit", payload]); },
			followUp: async (payload) => { calls.push(["follow", payload]); },
		};
		await respondWithError(interaction, "Try again later.");
		assert.equal(calls[0][0], { new: "reply", deferred: "edit", replied: "follow" }[state]);
		if (state !== "deferred") assert.equal(calls[0][1].flags, MessageFlags.Ephemeral);
	}
	await assert.doesNotReject(respondWithError({ reply: async () => { throw new Error("expired"); } }));
});

test("cooldowns persist across users and expire without resetting other commands", async (context) => {
	context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000 });
	let runs = 0;
	const replies = [];
	const client = { commands: new Collection([["demo", { data: { name: "demo" }, cooldown: 5, execute: async () => { runs++; } }]]) };
	const interaction = {
		client, commandName: "demo", user: { id: "alice" },
		isAutocomplete: () => false, isChatInputCommand: () => true,
		reply: async (payload) => { replies.push(payload); },
	};
	await interactionCreate(interaction);
	await interactionCreate(interaction);
	assert.equal(runs, 1);
	assert.match(replies[0].content, /cooldown/);
	await interactionCreate({ ...interaction, user: { id: "bob" } });
	assert.equal(runs, 2);
	context.mock.timers.tick(5_001);
	await interactionCreate(interaction);
	assert.equal(runs, 3);
});

test("missing commands and failed execution produce a safe user response", async (context) => {
	silence(context);
	for (const exists of [false, true]) {
		const replies = [];
		const command = { data: { name: "demo" }, cooldown: 0, execute: async () => { throw new Error("private DB details"); } };
		await interactionCreate({
			client: { commands: new Collection(exists ? [["demo", command]] : []) },
			commandName: "demo", user: { id: "alice" },
			isAutocomplete: () => false, isChatInputCommand: () => true,
			reply: async (payload) => { replies.push(payload); },
		});
		assert.equal(replies.length, 1);
		assert.ok(!replies[0].content.includes("private DB details"));
	}
});

test("activity commands acknowledge before querying and report an outage instead of no data", async (context) => {
	silence(context);
	for (const [execute, method] of [[activityCommand, "getUserActivity"], [leaderboardCommand, "getTopActiveUsers"], [streaksCommand, "getTopStreakUsers"]]) {
		const replies = [];
		const interaction = {
			guild: { id: "guild", name: "Guild" }, user: { id: "user", username: "Fixture" },
			options: { getUser: () => null, getInteger: () => null },
			deferred: false,
			async deferReply() { this.deferred = true; },
			editReply: async (payload) => { replies.push(payload); },
		};
		await execute(interaction, { [method]: async () => {
			assert.equal(interaction.deferred, true);
			throw new Error("database unavailable");
		} });
		assert.equal(replies.length, 1);
		assert.match(replies[0].content, /Failed to fetch/);
		assert.ok(!replies[0].content.includes("No activity"));
	}
});

test("non-administrators cannot invoke operational commands", async () => {
	for (const commandName of ["reload", "toggleai"]) {
		const replies = [];
		await interactionCreate({
			commandName, isAutocomplete: () => false, isChatInputCommand: () => true,
			memberPermissions: { has: () => false },
			reply: async (payload) => { replies.push(payload); },
		});
		assert.match(replies[0].content, /administrators/);
	}
});

test("transaction rollback uses the checked-out client and discards it after rollback failure", async () => {
	for (const rollbackFails of [false, true]) {
		const calls = [];
		const source = { connect: async () => ({
			query: async (sql) => {
				calls.push(sql);
				if (sql === "ROLLBACK" && rollbackFails) throw new Error("connection lost");
			},
			release: (broken) => { calls.push(broken); },
		}) };
		await assert.rejects(withTransaction(async (query) => {
			await query("WRITE");
			throw new Error("write failed");
		}, source), /write failed/);
		assert.deepEqual(calls, ["BEGIN", "WRITE", "ROLLBACK", rollbackFails]);
	}
});

function aiFixture() {
	const sent = [];
	const message = {
		id: "message", content: "hello", author: { id: "user", username: "Fixture" }, client: { user: { id: "bot" } },
		channel: { id: "channel", send: async (payload) => { sent.push(payload); } },
	};
	const dependencies = {
		isAIEnabled: () => true, logger,
		getConversationContext: async () => [], chat: async () => "Hello",
		storeMessage: async () => 1,
	};
	return { sent, message, dependencies };
}

test("AI can reply without memory and memory write failures do not trigger a second reply", async (context) => {
	silence(context);
	const { sent, message, dependencies } = aiFixture();
	dependencies.getConversationContext = async () => { throw new Error("DB unavailable"); };
	dependencies.storeMessage = async () => { throw new Error("DB unavailable"); };
	await caitlynAI(message, dependencies);
	assert.equal(sent.length, 1);
	assert.equal(sent[0].content, "Hello");
	assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});

test("AI send failures, including fallback failures, never escape", async (context) => {
	silence(context);
	const { message, dependencies } = aiFixture();
	let sends = 0;
	message.channel.send = async () => {
		sends++;
		throw new Error("permission denied");
	};
	await assert.doesNotReject(caitlynAI(message, dependencies));
	assert.equal(sends, 1);
	dependencies.chat = async () => { throw new Error("API failed"); };
	await assert.doesNotReject(caitlynAI(message, dependencies));
	assert.equal(sends, 2);
});

test("AI skips empty text and bounds concurrent work in the same channel", async (context) => {
	silence(context);
	const { message, dependencies } = aiFixture();
	let chats = 0;
	let finish;
	dependencies.chat = () => {
		chats++;
		return new Promise((resolve) => { finish = resolve; });
	};
	await caitlynAI({ ...message, content: "  " }, dependencies);
	assert.equal(chats, 0);
	const first = caitlynAI(message, dependencies);
	await new Promise((resolve) => setImmediate(resolve));
	await caitlynAI(message, dependencies);
	assert.equal(chats, 1);
	finish("Done");
	await first;
});

test("HTTP failures and invalid responses reject and every API request has a deadline", async (context) => {
	silence(context);
	for (const invoke of [
		(fetch) => chat([{ role: "user", content: "hello" }], null, { fetch }),
		(fetch) => generateEmbedding("hello", { fetch }),
	]) {
		for (const response of [new Response("secret details", { status: 503 }), new Response("null"), new Response("not JSON")]) {
			await assert.rejects(invoke(async (_url, options) => {
				assert.ok(options.signal instanceof AbortSignal);
				return response;
			}));
		}
	}
	for (const embedding of [[], [1], Array(768).fill(0), Array(768).fill("invalid")]) {
		await assert.rejects(generateEmbedding("hello", { fetch: async () => new Response(JSON.stringify({ embedding })) }), /Invalid embedding/);
	}
});

test("zero context counts skip the database and embedding service", async (context) => {
	context.mock.method(pool, "query", async () => { assert.fail("unexpected database request"); });
	context.mock.method(globalThis, "fetch", async () => { assert.fail("unexpected embedding request"); });
	assert.deepEqual(await getConversationContext({ channelId: "channel", currentMessage: "", recentCount: 0, similarCount: 0 }), []);
});

test("timeouts reject stalled work and message chunks respect Discord limits", async () => {
	await assert.rejects(withTimeout(new Promise(() => undefined), 1, "Test request"), /timed out/);
	assert.equal(await withTimeout(Promise.resolve(42), 100, "Test request"), 42);
	const chunks = messageChunks("🎂".repeat(5_000));
	assert.ok(chunks.every((chunk) => chunk.length <= 2_000 && chunk.isWellFormed()));
	assert.ok(chunks.join("").length <= 6_000);
});

test("failed command imports preserve the working command", async (context) => {
	silence(context);
	const command = { data: { name: "ping" }, category: "utility" };
	const commands = new Map([["ping", command]]);
	await reload({ client: { commands }, options: { getString: () => "ping" }, reply: async () => undefined }, {
		now: Date.now, importModule: async () => { throw new Error("syntax error"); },
	});
	assert.equal(commands.get("ping"), command);
});
