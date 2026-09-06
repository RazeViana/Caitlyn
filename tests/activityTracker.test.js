/**
 * @file activityTracker.test.js
 * @description Tests transactional activity writes, persisted voice sessions, and activity queries.
 * Checks retry safety and failure propagation without connecting to PostgreSQL.
 *
 * @module activityTracker.test
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
const activityTracker = await import("../core/activityTracker.ts");
const { pool } = await import("../core/createPGPool.ts");
const originalPoolQuery = pool.query;
afterEach(() => { pool.query = originalPoolQuery; });

test("message tracking groups both counter writes inside one transaction", async () => {
	const calls = [];
	let transactions = 0;
	await activityTracker.trackMessage("guild", "user", "Fixture", {
		now: () => 1_000,
		transaction: async (operation) => {
			transactions++;
			return operation(async (sql, values) => {
				calls.push({ sql, values });
				return { rows: [] };
			});
		},
	});
	assert.equal(transactions, 1);
	assert.match(calls[0].sql, /pg_advisory_xact_lock/);
	assert.match(calls[1].sql, /increment_message_count/);
	assert.match(calls[2].sql, /record_daily_activity/);
});

test("voice leave only increments totals for a newly finalized persisted session", async () => {
	const calls = [];
	const dependencies = {
		now: () => 15_000,
		transaction: async (operation) => operation(async (sql, values) => {
			calls.push({ sql, values });
			return { rows: sql.includes("RETURNING duration_seconds") ? [{ duration_seconds: "5" }] : [] };
		}),
	};
	await activityTracker.trackVoiceLeave("guild", "user", "Fixture", dependencies, "channel");
	assert.match(calls[1].sql, /left_at IS NULL/);
	assert.equal(calls[1].values[3], "channel");
	assert.equal(calls[2].values[3], 5);
	assert.equal(calls[3].values[3], 5);
	calls.length = 0;
	dependencies.transaction = async (operation) => operation(async (sql) => {
		calls.push(sql);
		return { rows: [] };
	});
	await activityTracker.trackVoiceLeave("guild", "user", "Fixture", dependencies);
	assert.equal(calls.length, 2);
});

test("voice joins reuse persisted same-channel sessions after a restart", async () => {
	const calls = [];
	await activityTracker.trackVoiceJoin("guild", "user", "Fixture", "channel", "Room", {
		now: () => 15_000,
		transaction: async (operation) => operation(async (sql) => {
			calls.push(sql);
			return { rows: sql.startsWith("SELECT channel_id") ? [{ channel_id: "channel" }] : [] };
		}),
	});
	assert.equal(calls.length, 2);
	assert.ok(calls.every((sql) => !sql.includes("INSERT")));
});

test("tracking write failures propagate so callers cannot continue a failed channel move", async () => {
	await assert.rejects(activityTracker.trackMessage("guild", "user", "Fixture", {
		now: () => 0,
		transaction: async () => { throw new Error("write failed"); },
	}), /write failed/);
});

test("activity reads distinguish unavailable services from empty results", async () => {
	const queries = [];
	const expectedUser = { user_id: "user-id", username: "Alice" };
	const expectedLeaders = [{ user_id: "leader-id", username: "Bob" }];
	const expectedStreaks = [{ user_id: "streak-id", username: "Carol" }];
	pool.query = async (text, values) => {
		queries.push({ text, values });
		if (text.includes("get_user_activity")) return { rows: [expectedUser] };
		if (text.includes("get_top_active_users")) return { rows: expectedLeaders };
		return { rows: expectedStreaks };
	};

	assert.equal(await activityTracker.getUserActivity("guild-id", "user-id"), expectedUser);
	assert.equal(await activityTracker.getTopActiveUsers("guild-id"), expectedLeaders);
	assert.equal(await activityTracker.getTopStreakUsers("guild-id", 5), expectedStreaks);
	assert.deepEqual(queries, [
		{
			text: "SELECT * FROM discord.get_user_activity($1, $2)",
			values: ["guild-id", "user-id"],
		},
		{
			text: "SELECT * FROM discord.get_top_active_users($1, $2)",
			values: ["guild-id", 10],
		},
		{
			text: "SELECT * FROM discord.get_top_streak_users($1, $2)",
			values: ["guild-id", 5],
		},
	]);

	const errors = [];
	const originalConsoleError = console.error;
	console.error = (...args) => {
		errors.push(args.join(" "));
	};
	pool.query = async () => {
		throw new Error("database unavailable");
	};

	try {
		await assert.rejects(activityTracker.getUserActivity("guild-id", "user-id"), /database unavailable/);
		await assert.rejects(activityTracker.getTopActiveUsers("guild-id"), /database unavailable/);
		await assert.rejects(activityTracker.getTopStreakUsers("guild-id"), /database unavailable/);
	}
	finally {
		console.error = originalConsoleError;
	}

	assert.equal(errors.length, 3);
	assert.match(errors[0], /Error getting user activity:.*database unavailable/s);
	assert.match(errors[1], /Error getting top active users:.*database unavailable/s);
	assert.match(errors[2], /Error getting top streak users:.*database unavailable/s);
});

test("formatDuration preserves hour, minute, second formatting", () => {
	assert.equal(activityTracker.formatDuration(0), "0s");
	assert.equal(activityTracker.formatDuration(59), "59s");
	assert.equal(activityTracker.formatDuration(60), "1m");
	assert.equal(activityTracker.formatDuration(3_600), "1h");
	assert.equal(activityTracker.formatDuration(3_661), "1h 1m 1s");
});
