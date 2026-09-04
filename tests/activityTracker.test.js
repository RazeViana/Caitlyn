import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const activityTracker = await import("../core/activityTracker.ts");
const { pool } = await import("../core/createPGPool.ts");

const originalPoolQuery = pool.query;

afterEach(() => {
	pool.query = originalPoolQuery;
});

test("message activity records count and daily activity in order", async () => {
	const queries = [];
	const sessions = new Map();
	const dependencies = {
		now: () => 1_000,
		query: async (text, values) => {
			queries.push({ text, values });
			return { rows: [] };
		},
		sessions,
	};

	await activityTracker.trackMessage("guild-id", "user-id", "Alice", dependencies);

	assert.deepEqual(queries, [
		{
			text: "SELECT discord.increment_message_count($1, $2, $3)",
			values: ["guild-id", "user-id", "Alice"],
		},
		{
			text: "SELECT discord.record_daily_activity($1, $2, $3)",
			values: ["guild-id", "user-id", "Alice"],
		},
	]);
	assert.equal(sessions.size, 0);
});

test("voice join stores the returned session and voice leave records elapsed seconds", async () => {
	const queries = [];
	const sessions = new Map();
	let currentTime = 10_000;
	const dependencies = {
		now: () => currentTime,
		query: async (text, values) => {
			queries.push({ text, values });
			return text.includes("RETURNING id") ? { rows: [{ id: 42 }] } : { rows: [] };
		},
		sessions,
	};

	await activityTracker.trackVoiceJoin(
		"guild-id",
		"user-id",
		"Alice",
		"channel-id",
		"General",
		dependencies,
	);

	assert.deepEqual(sessions.get("guild-id-user-id"), {
		channelId: "channel-id",
		joinedAt: 10_000,
		sessionId: 42,
	});
	assert.deepEqual(queries, [
		{
			text: "SELECT discord.increment_voice_join_count($1, $2, $3)",
			values: ["guild-id", "user-id", "Alice"],
		},
		{
			text: `INSERT INTO discord.voice_sessions
			(guild_id, user_id, username, channel_id, channel_name, joined_at)
			VALUES ($1, $2, $3, $4, $5, NOW())
			RETURNING id`,
			values: ["guild-id", "user-id", "Alice", "channel-id", "General"],
		},
	]);

	currentTime = 15_999;
	await activityTracker.trackVoiceLeave("guild-id", "user-id", "Alice", dependencies);

	assert.deepEqual(queries.slice(2), [
		{
			text: `UPDATE discord.voice_sessions
			SET left_at = NOW(), duration_seconds = $1
			WHERE id = $2`,
			values: [5, 42],
		},
		{
			text: "SELECT discord.add_voice_time($1, $2, $3, $4)",
			values: ["guild-id", "user-id", "Alice", 5],
		},
		{
			text: "SELECT discord.record_daily_voice_time($1, $2, $3, $4)",
			values: ["guild-id", "user-id", "Alice", 5],
		},
	]);
	assert.equal(sessions.has("guild-id-user-id"), false);
});

test("missing voice sessions keep the existing warning behavior", async () => {
	const warnings = [];
	const queries = [];
	const originalConsoleWarn = console.warn;
	console.warn = (...args) => {
		warnings.push(args.join(" "));
	};

	try {
		await activityTracker.trackVoiceLeave("guild-id", "user-id", "Alice", {
			now: () => 20_000,
			query: async (text, values) => {
				queries.push({ text, values });
				return { rows: [] };
			},
			sessions: new Map(),
		});
	}
	finally {
		console.warn = originalConsoleWarn;
	}

	assert.deepEqual(queries, []);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], /No active voice session found for Alice/);
});

test("activity reads preserve SQL, defaults, and error fallbacks", async () => {
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
		assert.equal(await activityTracker.getUserActivity("guild-id", "user-id"), null);
		assert.deepEqual(await activityTracker.getTopActiveUsers("guild-id"), []);
		assert.deepEqual(await activityTracker.getTopStreakUsers("guild-id"), []);
	}
	finally {
		console.error = originalConsoleError;
	}

	assert.equal(errors.length, 3);
	assert.match(errors[0], /Error getting user activity:.*database unavailable/s);
	assert.match(errors[1], /Error getting top active users:.*database unavailable/s);
	assert.match(errors[2], /Error getting top streak users:.*database unavailable/s);
});

test("tracking database errors are logged and swallowed", async () => {
	const errors = [];
	const originalConsoleError = console.error;
	console.error = (...args) => {
		errors.push(args.join(" "));
	};
	const dependencies = {
		now: () => 10_000,
		query: async () => {
			throw new Error("write failed");
		},
		sessions: new Map(),
	};

	try {
		await assert.doesNotReject(() => activityTracker.trackMessage(
			"guild-id",
			"user-id",
			"Alice",
			dependencies,
		));
	}
	finally {
		console.error = originalConsoleError;
	}

	assert.equal(errors.length, 1);
	assert.match(errors[0], /Error tracking message:.*write failed/s);
});

test("formatDuration preserves hour, minute, second formatting", () => {
	assert.equal(activityTracker.formatDuration(0), "0s");
	assert.equal(activityTracker.formatDuration(59), "59s");
	assert.equal(activityTracker.formatDuration(60), "1m");
	assert.equal(activityTracker.formatDuration(3_600), "1h");
	assert.equal(activityTracker.formatDuration(3_661), "1h 1m 1s");
});
