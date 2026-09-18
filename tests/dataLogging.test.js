/**
 * @file dataLogging.test.js
 * @description Checks plain-language collection logs, saved-versus-received accuracy and metadata privacy.
 * Uses synthetic Discord events and database substitutes; never contacts live services.
 *
 * @module dataLoggingTests
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { dataErrorReason, logData, formatDataDetails } from "../core/dataLog.ts";
import { subscribeLogs } from "../core/logger.ts";
import { withLogGuild } from "../core/logContext.ts";
import { trackMessage, trackVoiceJoin, trackVoiceLeave } from "../core/activityTracker.ts";
import { execute as messageCreate } from "../events/messageCreate.ts";
import { execute as messageDelete } from "../events/messageDelete.ts";
import { execute as addBirthday } from "../commands/user/addbirthday.ts";
import { execute as removeBirthday } from "../commands/user/removebirthday.ts";
import { createSocialDeliveryStore } from "../core/socialDeliveryStore.ts";
import { caitlynAI } from "../messages/caitlynAI.ts";

function capture(context) {
	const records = [];
	context.after(subscribeLogs((record) => records.push(record)));
	for (const method of ["log", "warn", "error"]) context.mock.method(console, method, () => undefined);
	return records;
}

function message() {
	return { id: "333", guildId: "111", channelId: "222", author: { id: "444", username: "Fixture", bot: false },
		content: "PRIVATE_MESSAGE_TEXT", attachments: new Map([["file", { name: "PRIVATE_FILENAME" }]]),
		client: { user: { id: "999" } }, channel: { id: "222", send: async () => undefined } };
}

test("data details allow only selected short scalar fields and cannot create extra log lines", () => {
	const details = formatDataDetails({ server: "111", user: "444", username: "line\n\u001b[31m\u2028\u2029" + "x".repeat(1000),
		count: 2, bytes: Infinity, fields: { content: "PRIVATE_OBJECT" }, content: "PRIVATE_BODY", token: "PRIVATE_TOKEN" });
	assert.match(details, /server: "111".*user: "444"/);
	assert.match(details, /count: 2/);
	assert.doesNotMatch(details, /PRIVATE_|Infinity/);
	for (const control of ["\n", "\r", "\u001b", "\u2028", "\u2029"]) assert.ok(!details.includes(control));
	assert.ok(details.length < 300);
});

test("data-service errors expose only known reasons, never request bodies or provider text", () => {
	assert.match(dataErrorReason(new Error("PRIVATE_MESSAGE_TEXT")), /hidden/);
	assert.match(dataErrorReason({ code: "PRIVATE_TEXT", status: "PRIVATE_STATUS" }), /hidden/);
	assert.equal(dataErrorReason({ code: "ECONNREFUSED", message: "PRIVATE_BODY" }), "network connection failed (ECONNREFUSED)");
	assert.equal(dataErrorReason(new Error("Open WebUI API returned 429")), "service returned HTTP 429");
	assert.match(dataErrorReason(new Error("Open WebUI API returned 429 PRIVATE_BODY")), /hidden/);
});

test("collection logs retain separate server context and default to DEBUG", async (context) => {
	const records = capture(context);
	await Promise.all(["111", "222"].map((server) => withLogGuild(server, async () => {
		await new Promise((resolve) => setImmediate(resolve));
		logData("Read saved details", { user: "444" });
	})));
	assert.deepEqual(records.map((record) => record.guildId).sort(), ["111", "222"]);
	assert.ok(records.every((record) => record.level === "DEBUG" && record.message.includes(`server: "${record.guildId}"`)));
});

test("received-message logs exclude text and attachment names and do not claim a save", async (context) => {
	const records = capture(context);
	const input = message();
	await messageCreate(input, async () => undefined);
	assert.equal(records.length, 1);
	assert.equal(records[0].guildId, "111");
	assert.match(records[0].message, /Received a message.*user: "444".*message: "333".*attachments: 1/);
	assert.doesNotMatch(records[0].message, /PRIVATE_|Saved/);
	input.author.bot = true;
	await messageCreate(input, async () => assert.fail("bot message routed"));
	await messageDelete(input);
	assert.equal(records.length, 1);
});

test("activity save is logged only after commit, never after a failed write or commit", async (context) => {
	const records = capture(context);
	for (const fail of [true, false]) {
		const dependencies = { now: () => 0, transaction: async (operation) => {
			await operation(async () => ({ rows: [] }));
			assert.equal(records.length, 0, "must not announce an uncommitted save");
			if (fail) throw new Error("commit failed");
		} };
		if (fail) await assert.rejects(trackMessage("111", "444", "Fixture", dependencies), /commit failed/);
		else await trackMessage("111", "444", "Fixture", dependencies, { channelId: "222", messageId: "333" });
	}
	assert.equal(records.length, 1);
	assert.match(records[0].message, /Saved message activity.*message count, activity day and streak/);
	assert.match(records[0].message, /channel: "222".*message: "333"/);
	assert.equal(records[0].guildId, "111");
});

test("voice logs distinguish counted time, missing sessions and a repeated join", async (context) => {
	const records = capture(context);
	const dependencies = { now: () => 30000, transaction: async (operation) => operation(async (sql) => ({
		rows: sql.includes("RETURNING duration_seconds") ? [{ duration_seconds: 25 }] : [],
	})) };
	await trackVoiceLeave("111", "444", "Fixture", dependencies, "222");
	assert.match(records.at(-1).message, /Saved voice leave.*seconds counted: 25/);
	dependencies.transaction = async (operation) => operation(async () => ({ rows: [] }));
	await trackVoiceLeave("111", "444", "Fixture", dependencies, "222");
	assert.match(records.at(-1).message, /No saved voice session to close; no time added/);
	await trackVoiceJoin("111", "444", "Fixture", "222", "Room", dependencies);
	assert.match(records.at(-1).message, /Saved voice join.*channel name: "Room"/);
	dependencies.transaction = async (operation) => operation(async (sql) => ({ rows: sql.startsWith("SELECT channel_id") ? [{ channel_id: "222" }] : [] }));
	await trackVoiceJoin("111", "444", "Fixture", "222", "Room", dependencies);
	assert.match(records.at(-1).message, /Voice session already saved; join not counted again/);
	const before = records.length;
	dependencies.transaction = async (operation) => {
		await operation(async () => ({ rows: [] }));
		throw new Error("commit failed");
	};
	await assert.rejects(trackVoiceJoin("111", "444", "Fixture", "222", "Room", dependencies));
	assert.equal(records.length, before);
});

function birthdayInteraction() {
	return { guildId: "111", user: { id: "555" }, deferred: false,
		options: { getUser: () => ({ id: "444", username: "Fixture" }), getInteger: (key) => key === "day" ? 13 : 1994, getString: () => "7" },
		async deferReply() { this.deferred = true; }, editReply: async () => undefined, reply: async () => undefined };
}

test("birthday logs identify the subject and requester without the birth date", async (context) => {
	const records = capture(context);
	await addBirthday(birthdayInteraction(), { query: async () => ({ rows: [] }) });
	const saved = records.find((record) => record.message.startsWith("Saved birthday details"));
	assert.equal(saved.level, "INFO");
	assert.match(saved.message, /user: "444".*requested by: "555".*date of birth/);
	assert.doesNotMatch(saved.message, /1994|07-13/);
	await removeBirthday(birthdayInteraction(), { query: async () => ({ rows: [] }) });
	assert.ok(records.some((record) => record.level === "DEBUG" && record.message.startsWith("No saved birthday found")));
	await removeBirthday(birthdayInteraction(), { query: async () => ({ rows: [{ discord_id: "444" }] }) });
	assert.ok(records.some((record) => record.level === "INFO" && record.message.startsWith("Deleted saved birthday details")));
	const before = records.filter((record) => record.message.startsWith("Saved birthday details")).length;
	await addBirthday(birthdayInteraction(), { query: async () => { throw new Error("database unavailable"); } });
	assert.equal(records.filter((record) => record.message.startsWith("Saved birthday details")).length, before);
});

test("social cancellation logs only affected saved previews, not every unrelated deletion", async (context) => {
	const records = capture(context);
	let rowCount = 0;
	const store = createSocialDeliveryStore({ query: async () => ({ rowCount }) });
	await store.cancelSource("111", "222", "333");
	assert.equal(records.length, 0);
	rowCount = 2;
	await store.cancelSource("111", "222", "333");
	assert.match(records[0].message, /Saved requests to stop or remove linked social previews.*message: "333".*count: 2/);
});

test("AI logs identify processing and sent replies without prompt, memory or reply text", async () => {
	const records = [];
	const input = message();
	const dependencies = { isAIEnabled: () => false, memoryEnabled: () => false,
		chat: async () => "PRIVATE_AI_REPLY", getConversationContext: async () => assert.fail("memory disabled"),
		storeMessage: async () => assert.fail("memory disabled"),
		logger: { debug: (...args) => records.push(args.join(" ")), error: (...args) => records.push(args.join(" ")) } };
	await caitlynAI(input, dependencies);
	assert.match(records[0], /AI message not processed/);
	assert.ok(!records.some((record) => record.includes("Sent the AI reply")));
	dependencies.isAIEnabled = () => true;
	await caitlynAI(input, dependencies);
	assert.ok(records.some((record) => record.includes("without saving conversation memory")));
	assert.ok(records.some((record) => record.includes("Sent the AI reply")));
	assert.ok(records.every((record) => !record.includes("PRIVATE_")));
	const before = records.filter((record) => record.includes("Sent the AI reply")).length;
	input.channel.send = async () => { throw new Error("PRIVATE_AI_REPLY in request body"); };
	await caitlynAI(input, dependencies);
	assert.equal(records.filter((record) => record.includes("Sent the AI reply")).length, before);
	assert.ok(records.every((record) => !record.includes("PRIVATE_")));
});
