import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.EMBEDDING_ENDPOINT = "data:application/json,%7B%22embedding%22%3A%5B0.25%2C-0.5%5D%7D";
process.env.EMBEDDING_MODEL = "dummy-embedding-model";
process.env.PGDATABASE = "dummy_database";
process.env.PGHOST = "localhost";
process.env.PGPASSWORD = "dummy_password";
process.env.PGPORT = "5432";
process.env.PGUSER = "dummy_user";

const { pool } = await import("../core/createPGPool.ts");
const { getConversationContext, storeMessage } = await import("../core/messageStore.ts");

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
		"[0.25,-0.5]",
	]);
	assert.match(calls[2].query, /\$1::vector/);
	assert.deepEqual(calls[2].values, ["[0.25,-0.5]", "channel-1", 0.75, 2]);
	assert.deepEqual(context.map(({ id: messageId, source }) => ({ id: messageId, source })), [
		{ id: 1, source: "recent" },
		{ id: 3, source: "similar" },
		{ id: 2, source: "recent" },
	]);
});
