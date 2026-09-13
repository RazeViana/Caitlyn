/**
 * @file activityCommands.test.js
 * @description Tests activity, leaderboard, streak, and AI-toggle command responses.
 * Checks rendering, empty results, permissions metadata, and confirmation failures with substitutes.
 *
 * @module activityCommands.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageFlags, PermissionFlagsBits } from "discord.js";

process.env.LLM_ENABLED = "false";
process.env.OLLAMA_MODEL = "fixture";
process.env.WEBUI_API_KEY = "fixture";
process.env.WEBUI_CHAT_ENDPOINT = "https://fixture.invalid/chat";

const activityCommand = await import("../commands/user/activity.ts");
const leaderboardCommand = await import("../commands/utility/leaderboard.ts");
const streaksCommand = await import("../commands/utility/streaks.ts");
const toggleAICommand = await import("../commands/utility/toggleai.ts");
const { isAIEnabled, resetAIState } = await import("../core/aiState.ts");

function commandUser(id, username) {
	return {
		displayAvatarURL: () => `https://cdn.invalid/${id}.png`,
		id,
		username,
	};
}

test("activity command renders counts, averages, and streak fields", async () => {
	const replies = [];
	const requester = commandUser("requester-id", "Requester");
	const target = commandUser("target-id", "Alice");
	const interaction = {
		guild: { id: "guild-id" },
		options: { getUser: () => target },
		deferReply: async () => undefined,
		editReply: async (response) => {
			replies.push(response);
		},
		user: requester,
	};
	const row = {
		activity_score: "99",
		daily_streak_current: 4,
		daily_streak_longest: 9,
		first_seen_at: new Date("2026-09-01T00:00:00.000Z"),
		last_seen_at: new Date("2026-09-03T00:00:00.000Z"),
		message_count: "10",
		monthly_streak_current: 2,
		monthly_streak_longest: 3,
		total_voice_time: "3661",
		user_id: "target-id",
		username: "Alice",
		voice_join_count: "7",
		weekly_streak_current: 3,
		weekly_streak_longest: 5,
	};

	await activityCommand.execute(interaction, {
		getUserActivity: async (guildId, userId) => {
			assert.equal(guildId, "guild-id");
			assert.equal(userId, "target-id");
			return row;
		},
	});

	assert.equal(activityCommand.cooldown, 5);
	assert.equal(activityCommand.category, "user");
	const activityMetadata = activityCommand.data.toJSON();
	assert.equal(activityMetadata.name, "activity");
	assert.equal(activityMetadata.description, "View user activity statistics");
	assert.equal(activityMetadata.options.length, 1);
	assert.deepEqual({
		description: activityMetadata.options[0].description,
		name: activityMetadata.options[0].name,
		required: activityMetadata.options[0].required,
		type: activityMetadata.options[0].type,
	}, {
		description: "The user to view activity for (defaults to yourself)",
		name: "user",
		required: false,
		type: 6,
	});
	assert.equal(replies.length, 1);
	const response = replies[0];
	assert.deepEqual(Object.keys(response), ["embeds"]);
	const embed = response.embeds[0].toJSON();
	assert.equal(embed.color, 0x5865f2);
	assert.equal(embed.title, "📊 Activity Stats for Alice");
	assert.deepEqual(embed.thumbnail, { url: "https://cdn.invalid/target-id.png" });
	assert.deepEqual(embed.fields, [
		{ inline: true, name: "💬 Messages Sent", value: "10" },
		{ inline: true, name: "🎤 Voice Joins", value: "7" },
		{ inline: true, name: "⏱️ Time in Voice", value: "1h 1m 1s" },
		{ inline: true, name: "📊 Avg Messages/Day", value: "3.3" },
		{ inline: true, name: "📊 Avg Voice Time/Day", value: "20m 20s" },
		{ inline: true, name: "📆 Days Active", value: "3" },
		{ inline: true, name: "📅 First Seen", value: "<t:1788220800:R>" },
		{ inline: true, name: "👁️ Last Seen", value: "<t:1788393600:R>" },
		{ inline: true, name: "​", value: "​" },
		{ inline: true, name: "🔥 Daily Streak", value: "**4** days (Best: 9)" },
		{ inline: true, name: "📅 Weekly Streak", value: "**3** weeks (Best: 5)" },
		{ inline: true, name: "📆 Monthly Streak", value: "**2** months (Best: 3)" },
	]);
	assert.deepEqual(embed.footer, {
		icon_url: "https://cdn.invalid/requester-id.png",
		text: "Requested by Requester",
	});
	assert.match(embed.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("activity command edits its deferred response for an empty result", async () => {
	const replies = [];
	const requester = commandUser("requester-id", "Requester");
	await activityCommand.execute({
		guild: { id: "guild-id" },
		options: { getUser: () => null },
		deferReply: async () => undefined,
		editReply: async (response) => {
			replies.push(response);
		},
		user: requester,
	}, {
		getUserActivity: async () => null,
	});

	assert.deepEqual(replies, [{
		content: "No activity data found for Requester.",
	}]);
});

test("leaderboard and streak commands preserve ordering and empty states", async () => {
	const leaderboardEdits = [];
	let deferred = 0;
	const guild = { id: "guild-id", name: "Test Guild" };
	const requester = commandUser("requester-id", "Requester");
	await leaderboardCommand.execute({
		deferReply: async () => {
			deferred += 1;
		},
		editReply: async (response) => {
			leaderboardEdits.push(response);
		},
		guild,
		options: { getInteger: () => 5 },
		user: requester,
	}, {
		getTopActiveUsers: async (guildId, limit) => {
			assert.equal(guildId, "guild-id");
			assert.equal(limit, 5);
			return [
				{
					activity_score: "50",
					message_count: "10",
					total_voice_time: "60",
					user_id: "alice-id",
					username: "Alice",
					voice_join_count: "2",
				},
				{
					activity_score: "40",
					message_count: "8",
					total_voice_time: "0",
					user_id: "bob-id",
					username: "Bob",
					voice_join_count: "1",
				},
			];
		},
	});

	assert.equal(leaderboardCommand.cooldown, 10);
	assert.equal(leaderboardCommand.category, "utility");
	const leaderboardMetadata = leaderboardCommand.data.toJSON();
	assert.equal(leaderboardMetadata.name, "leaderboard");
	assert.equal(leaderboardMetadata.description, "View the server activity leaderboard");
	assert.equal(leaderboardMetadata.options.length, 1);
	assert.deepEqual({
		description: leaderboardMetadata.options[0].description,
		max_value: leaderboardMetadata.options[0].max_value,
		min_value: leaderboardMetadata.options[0].min_value,
		name: leaderboardMetadata.options[0].name,
		required: leaderboardMetadata.options[0].required,
		type: leaderboardMetadata.options[0].type,
	}, {
		description: "Number of users to show (default: 10)",
		max_value: 25,
		min_value: 5,
		name: "limit",
		required: false,
		type: 4,
	});
	assert.equal(deferred, 1);
	const leaderboardEmbed = leaderboardEdits[0].embeds[0].toJSON();
	assert.equal(leaderboardEmbed.color, 0xffd700);
	assert.equal(leaderboardEmbed.title, "🏆 Test Guild Activity Leaderboard");
	assert.equal(
		leaderboardEmbed.description,
		"🥇 **Alice**\n    💬 10 messages | 🎤 2 joins | ⏱️ 1m\n    📊 Score: 50\n\n"
		+ "🥈 **Bob**\n    💬 8 messages | 🎤 1 joins | ⏱️ 0s\n    📊 Score: 40",
	);
	assert.equal(
		leaderboardEmbed.footer.text,
		"Activity Score = Messages + Voice Joins + (Voice Time / 60)",
	);

	leaderboardEdits.length = 0;
	await leaderboardCommand.execute({
		deferReply: async () => undefined,
		editReply: async (response) => {
			leaderboardEdits.push(response);
		},
		guild,
		options: { getInteger: () => null },
		user: requester,
	}, {
		getTopActiveUsers: async () => [],
	});
	assert.deepEqual(leaderboardEdits, [{
		content: "No activity data available yet. Start chatting to build the leaderboard!",
	}]);

	const streakReplies = [];
	await streaksCommand.execute({
		guild,
		options: { getInteger: () => 5 },
		deferReply: async () => undefined,
		editReply: async (response) => {
			streakReplies.push(response);
		},
		user: requester,
	}, {
		getTopStreakUsers: async (guildId, limit) => {
			assert.equal(guildId, "guild-id");
			assert.equal(limit, 5);
			return [
				{
					daily_streak_current: 8,
					daily_streak_longest: 12,
					monthly_streak_current: 2,
					user_id: "alice-id",
					username: "Alice",
					weekly_streak_current: 4,
				},
				{
					daily_streak_current: 6,
					daily_streak_longest: 7,
					monthly_streak_current: 1,
					user_id: "bob-id",
					username: "Bob",
					weekly_streak_current: 3,
				},
			];
		},
	});
	assert.equal(streaksCommand.cooldown, 5);
	assert.equal(streaksCommand.category, "utility");
	const streaksMetadata = streaksCommand.data.toJSON();
	assert.equal(streaksMetadata.name, "streaks");
	assert.equal(streaksMetadata.description, "View the server activity streak leaderboard");
	assert.equal(streaksMetadata.options.length, 1);
	assert.deepEqual({
		description: streaksMetadata.options[0].description,
		max_value: streaksMetadata.options[0].max_value,
		min_value: streaksMetadata.options[0].min_value,
		name: streaksMetadata.options[0].name,
		required: streaksMetadata.options[0].required,
		type: streaksMetadata.options[0].type,
	}, {
		description: "Number of users to show (default: 10)",
		max_value: 25,
		min_value: 5,
		name: "limit",
		required: false,
		type: 4,
	});
	const streakEmbed = streakReplies[0].embeds[0].toJSON();
	assert.equal(streakEmbed.color, 0xff6b35);
	assert.equal(streakEmbed.title, "🔥 Activity Streak Leaderboard");
	assert.equal(
		streakEmbed.description,
		"🥇 **Alice**\n   🔥 Daily: **8** (Best: 12)\n   📅 Weekly: **4** | 📆 Monthly: **2**\n\n"
		+ "🥈 **Bob**\n   🔥 Daily: **6** (Best: 7)\n   📅 Weekly: **3** | 📆 Monthly: **1**\n\n",
	);

	streakReplies.length = 0;
	await streaksCommand.execute({
		guild,
		options: { getInteger: () => null },
		deferReply: async () => undefined,
		editReply: async (response) => {
			streakReplies.push(response);
		},
		user: requester,
	}, {
		getTopStreakUsers: async () => [],
	});
	assert.deepEqual(streakReplies, [{
		content: "No activity streak data found for this server yet.",
	}]);
});

test("toggleai preserves administrator metadata and ephemeral response", async () => {
	const originalLLMEnabled = process.env.LLM_ENABLED;
	const originalConsoleLog = console.log;
	const replies = [];
	console.log = () => undefined;
	process.env.LLM_ENABLED = "false";
	resetAIState();

	try {
		await toggleAICommand.execute({
			reply: async (response) => {
				replies.push(response);
			},
			user: commandUser("requester-id", "Requester"),
		});

		assert.equal(toggleAICommand.cooldown, 5);
		assert.equal(toggleAICommand.category, "utility");
		const metadata = toggleAICommand.data.toJSON();
		assert.equal(metadata.name, "toggleai");
		assert.equal(metadata.description, "Toggle Caitlyn AI on/off");
		assert.equal(metadata.default_member_permissions, PermissionFlagsBits.Administrator.toString());
		assert.equal(isAIEnabled(), true);
		assert.deepEqual(replies, [{
			content: "✅ Caitlyn AI is now **enabled**",
			flags: MessageFlags.Ephemeral,
		}]);
	}
	finally {
		if (originalLLMEnabled === undefined) delete process.env.LLM_ENABLED;
		else process.env.LLM_ENABLED = originalLLMEnabled;
		resetAIState();
		console.log = originalConsoleLog;
	}
});

test("toggleai changes enabled AI to disabled and replies with the disabled ephemeral response", async () => {
	const originalLLMEnabled = process.env.LLM_ENABLED;
	const originalConsoleLog = console.log;
	const replies = [];
	console.log = () => undefined;
	process.env.LLM_ENABLED = "true";
	resetAIState();

	try {
		await toggleAICommand.execute({
			reply: async (response) => {
				replies.push(response);
			},
			user: commandUser("requester-id", "Requester"),
		});

		assert.equal(isAIEnabled(), false);
		assert.deepEqual(replies, [{
			content: "❌ Caitlyn AI is now **disabled**",
			flags: MessageFlags.Ephemeral,
		}]);
	}
	finally {
		if (originalLLMEnabled === undefined) delete process.env.LLM_ENABLED;
		else process.env.LLM_ENABLED = originalLLMEnabled;
		resetAIState();
		console.log = originalConsoleLog;
	}
});

test("toggleai reports the actual state when its confirmation fails", async () => {
	const originalLLMEnabled = process.env.LLM_ENABLED;
	const originalConsoleError = console.error;
	const originalConsoleLog = console.log;
	const replies = [];
	let replyAttempts = 0;
	console.error = () => undefined;
	console.log = () => undefined;
	process.env.LLM_ENABLED = "false";
	resetAIState();

	try {
		await toggleAICommand.execute({
			reply: async (response) => {
				replyAttempts += 1;
				if (replyAttempts === 1) throw new Error("success reply unavailable");
				replies.push(response);
			},
			user: commandUser("requester-id", "Requester"),
		});

		assert.equal(replyAttempts, 2);
		assert.deepEqual(replies, [{
			content: "Could not confirm the change. AI is currently enabled.",
			flags: MessageFlags.Ephemeral,
		}]);
	}
	finally {
		if (originalLLMEnabled === undefined) delete process.env.LLM_ENABLED;
		else process.env.LLM_ENABLED = originalLLMEnabled;
		resetAIState();
		console.error = originalConsoleError;
		console.log = originalConsoleLog;
	}
});
