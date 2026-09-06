/**
 * @file messageStore.test.js
 * @description Tests vector-message storage, context ordering, and old-message cleanup.
 * Checks SQL arguments and failure propagation using database substitutes.
 *
 * @module messageStore.test
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const fixtureEmbedding = Array.from({ length: 768 }, () => 0.25);
const vectorString = JSON.stringify(fixtureEmbedding);
process.env.EMBEDDING_ENDPOINT = `data:application/json,${encodeURIComponent(JSON.stringify({ embedding: fixtureEmbedding }))}`;
process.env.EMBEDDING_MODEL = "dummy-embedding-model";
process.env.PGDATABASE = "dummy_database";
process.env.PGHOST = "localhost";
process.env.PGPASSWORD = "dummy_password";
process.env.PGPORT = "5432";
process.env.PGUSER = "dummy_user";

const { pool } = await import("../core/createPGPool.ts");
const { default: logger } = await import("../core/logger.ts");
const { clearOldMessages, getConversationContext, storeMessage } = await import("../core/messageStore.ts");

const originalPoolQuery = pool.query.bind(pool);

afterEach(() => {
	pool.query = originalPoolQuery;
});

test("message storage preserves vector SQL and context ordering", async () => {
	const calls = [];
	pool.query = async (query, values) => {
		calls.push({ query, values });
		if (query.includes("INSERT INTO discord.messages")) {
			return { rows: [{ id: 42 }] };
		}
		if (query.includes("discord.get_recent_messages")) {
			return { rows: [
				{ id: 2, username: "recent-two", role: "user", content: "later", created_at: new Date("2026-09-04T12:00:00Z") },
				{ id: 1, username: "recent-one", role: "assistant", content: "earlier", created_at: new Date("2026-09-04T10:00:00Z") },
			] };
		}
		if (query.includes("discord.search_similar_messages")) {
			return { rows: [
				{ id: 2, username: "duplicate", role: "user", content: "duplicate", similarity: 0.9, created_at: new Date("2026-09-04T12:00:00Z") },
				{ id: 3, username: "similar", role: "assistant", content: "middle", similarity: 0.8, created_at: new Date("2026-09-04T11:00:00Z") },
			] };
		}
		throw new Error(`Unexpected query: ${query}`);
	};

	const id = await storeMessage({
		channelId: "channel-1",
		messageId: "message-1",
		userId: "user-1",
		username: "Raze",
		role: "user",
		content: "Remember this",
	});
	const context = await getConversationContext({
		channelId: "channel-1",
		currentMessage: "What did I say?",
		recentCount: 2,
		similarCount: 2,
	});

	assert.equal(id, 42);
	assert.match(calls[0].query, /\$7::vector/);
	assert.deepEqual(calls[0].values, [
		"channel-1",
		"message-1",
		"user-1",
		"Raze",
		"user",
		"Remember this",
		vectorString,
	]);
	assert.match(calls[2].query, /\$1::vector/);
	assert.deepEqual(calls[2].values, [vectorString, "channel-1", 0.75, 2]);
	assert.deepEqual(context.map(({ id: messageId, source }) => ({ id: messageId, source })), [
		{ id: 1, source: "recent" },
		{ id: 3, source: "similar" },
		{ id: 2, source: "recent" },
	]);
});

test("old-message cleanup preserves its exact SQL, arguments, default, and row-count fallback", async (context) => {
	const calls = [];
	const logs = [];
	context.mock.method(logger, "info", (...args) => {
		logs.push(args.join(" "));
	});
	pool.query = async (query, values) => {
		calls.push({ query, values });
		return { rowCount: calls.length === 1 ? 7 : null, rows: [] };
	};

	assert.equal(await clearOldMessages("default-channel"), 7);
	assert.equal(await clearOldMessages("custom-channel", 14), 0);

	assert.deepEqual(calls, [
		{
			query: `
			DELETE FROM discord.messages
			WHERE channel_id = $1
			AND created_at < NOW() - INTERVAL '30 days'
		`,
			values: ["default-channel"],
		},
		{
			query: `
			DELETE FROM discord.messages
			WHERE channel_id = $1
			AND created_at < NOW() - INTERVAL '14 days'
		`,
			values: ["custom-channel"],
		},
	]);
	assert.equal(logs.length, 2);
	assert.equal(logs[0], "Cleared 7 old messages from channel default-channel");
	assert.equal(logs[1], "Cleared 0 old messages from channel custom-channel");
});

test("old-message cleanup logs and rethrows the database error", async () => {
	const databaseError = new Error("cleanup database unavailable");
	const errors = [];
	const originalConsoleError = console.error;
	console.error = (...args) => {
		errors.push(args.join(" "));
	};
	pool.query = async () => {
		throw databaseError;
	};

	try {
		await assert.rejects(
			() => clearOldMessages("error-channel", 5),
			(error) => error === databaseError,
		);
	}
	finally {
		console.error = originalConsoleError;
	}

	assert.equal(errors.length, 1);
	assert.match(errors[0], /\[ERROR\].*Error clearing old messages:.*cleanup database unavailable/s);
});
