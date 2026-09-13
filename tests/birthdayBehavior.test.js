/**
 * @file birthdayBehavior.test.js
 * @description Tests birthday validation, calendar rendering, mutations, and recovery scheduling.
 * Uses controlled database, Discord, HTTP, and scheduling dependencies.
 *
 * @module birthdayBehavior.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageFlags } from "discord.js";
import { birthdayDate, nextBirthday } from "../core/birthdayDate.ts";
const addBirthdayCommand = await import("../commands/user/addbirthday.ts");
const removeBirthdayCommand = await import("../commands/user/removebirthday.ts");
const showBirthdaysCommand = await import("../commands/user/showbirthdays.ts");
const { startBirthdayScheduledEvent } = await import("../jobs/birthdayScheduledEvent.ts");

function birthdayInteraction(day = 31) {
	const replies = [];
	return {
		replies,
		deferred: false,
		options: { getUser: () => ({ id: "1234", username: "Fixture" }), getInteger: (name) => name === "day" ? day : 1997, getString: () => "5" },
		async deferReply(options) { this.deferred = true; replies.push(["defer", options]); },
		async editReply(response) { replies.push(["edit", response]); },
		async reply(response) { replies.push(["reply", response]); },
	};
}

test("birthday upsert acknowledges first, preserves calendar date, and confirms success", async () => {
	const interaction = birthdayInteraction();
	const queries = [];
	await addBirthdayCommand.execute(interaction, { query: async (...args) => {
		assert.equal(interaction.deferred, true);
		queries.push(args);
		return { rows: [] };
	} });
	assert.equal(queries.length, 1);
	assert.match(queries[0][0], /ON CONFLICT \(discord_id\) DO UPDATE/);
	assert.deepEqual(queries[0][1], ["1234", "Fixture", "1997-05-31"]);
	assert.deepEqual(interaction.replies, [
		["defer", { flags: MessageFlags.Ephemeral }],
		["edit", { content: "Birthday saved for <@1234>!" }],
	]);
});

test("date-only validation handles month ends, leap days, invalid days, and timezones", () => {
	const originalTimezone = process.env.TZ;
	try {
		for (const zone of ["UTC", "Europe/Brussels", "America/Los_Angeles"]) {
			process.env.TZ = zone;
			assert.equal(birthdayDate(1997, 5, 31), "1997-05-31");
			assert.equal(birthdayDate(2000, 2, 29), "2000-02-29");
			for (const [year, month, day] of [[1997, 2, 29], [1997, 4, 31], [1997, 5, 0], [1997, 13, 1], [1997, 5, 1.5], [1800, 1, 1]]) {
				assert.equal(birthdayDate(year, month, day), null);
			}
			const today = new Date(2026, 8, 5, 12);
			assert.equal(nextBirthday(new Date(1997, 8, 5), today).getFullYear(), 2026);
			assert.equal(nextBirthday(new Date(2000, 1, 29), today).getFullYear(), 2028);
		}
	}
	finally {
		if (originalTimezone === undefined) delete process.env.TZ;
		else process.env.TZ = originalTimezone;
	}
});

test("birthday mutations report database errors and tolerate expired error responses", async (context) => {
	const { default: logger } = await import("../core/logger.ts");
	context.mock.method(logger, "error", () => undefined);
	context.mock.method(logger, "warn", () => undefined);
	for (const command of [addBirthdayCommand, removeBirthdayCommand]) {
		const interaction = birthdayInteraction();
		await command.execute(interaction, { query: async () => { throw new Error("DB down"); } });
		assert.match(interaction.replies[1][1].content, /Could not/);
		interaction.editReply = async () => { throw new Error("expired"); };
		await assert.doesNotReject(command.execute(interaction, { query: async () => { throw new Error("DB down"); } }));
	}
});

test("birthday removal uses parameterized delete and reports existing versus missing", async () => {
	for (const exists of [true, false]) {
		const interaction = birthdayInteraction();
		await removeBirthdayCommand.execute(interaction, { query: async (sql, values) => {
			assert.match(sql, /DELETE.*\$1 RETURNING/);
			assert.deepEqual(values, ["1234"]);
			return { rows: exists ? [{ discord_id: "1234" }] : [] };
		} });
		assert.match(interaction.replies[1][1].content, exists ? /deleted/ : /does not have/);
	}
});

test("showbirthdays without GIF configuration never calls the GIF API", async () => {
	const replies = [];
	await showBirthdaysCommand.execute({ guild: {}, deferReply: async () => undefined, editReply: async (reply) => replies.push(reply) }, {
		giphyEnabled: () => false,
		fetch: async () => assert.fail("unconfigured Giphy request"),
		query: async () => ({ rows: [] }),
	});
	assert.deepEqual(replies, ["😢 No birthdays found!"]);
});

test("showbirthdays preserves deferred reply and deterministic embed grouping", async (context) => {
	const originalTimezone = process.env.TZ;
	process.env.TZ = "Europe/Amsterdam";
	context.mock.timers.enable({
		apis: ["Date"],
		now: new Date(2026, 8, 4, 0, 0, 0),
	});

	try {
		const events = [];
		const fetchedMembers = [];
		const interaction = {
			deferReply: async () => {
				events.push("defer");
			},
			editReply: async (response) => {
				events.push(response);
			},
			guild: {
				members: {
					fetch: async (id) => {
						fetchedMembers.push(id);
						if (id === "missing-id") throw new Error("not in guild");
						return { displayName: id === "today-id" ? "Alice Display" : "Carol Display" };
					},
				},
			},
			user: {
				displayAvatarURL: () => "https://cdn.invalid/requester.png",
				username: "Requester",
			},
		};
		const queryCalls = [];
		const fetchCalls = [];

		await showBirthdaysCommand.execute(interaction, {
			fetch: async (url) => {
				fetchCalls.push(url);
				return {
					json: async () => ({ data: { images: { original: { url: "https://gif.invalid/birthday.gif" } } } }),
					ok: true,
					statusText: "OK",
				};
			},
			query: async (...args) => {
				queryCalls.push(args);
				return {
					rows: [
						{ discord_id: "later-id", dob: new Date(1991, 9, 20), name: "Carol" },
						{ discord_id: "today-id", dob: new Date(1990, 8, 4), name: "Alice" },
						{ discord_id: "missing-id", dob: new Date(1992, 9, 2), name: "Bob" },
					],
				};
			},
		});

		assert.equal(showBirthdaysCommand.category, "user");
		assert.equal("cooldown" in showBirthdaysCommand, false);
		assert.equal(fetchCalls.length, 1);
		const giphyURL = new URL(fetchCalls[0]);
		assert.equal(giphyURL.origin, "https://api.giphy.com");
		assert.equal(giphyURL.pathname, "/v1/gifs/random");
		assert.equal(giphyURL.searchParams.get("tag"), "birthday");
		assert.deepEqual(queryCalls, [["SELECT discord_id, name, dob::text FROM discord.birthdays"]]);
		assert.deepEqual(fetchedMembers, ["later-id", "today-id", "missing-id"]);
		assert.equal(events[0], "defer");
		const embed = events[1].embeds[0].toJSON();
		assert.equal(embed.title, "🎂 Birthday Calendar");
		assert.equal(embed.description, "Here are all the saved birthdays");
		assert.equal(embed.color, 0xff80ab);
		assert.deepEqual(embed.thumbnail, { url: "https://gif.invalid/birthday.gif" });
		assert.deepEqual(embed.footer, {
			icon_url: "https://cdn.invalid/requester.png",
			text: "Requested by Requester",
		});
		assert.equal(embed.timestamp, "2026-09-03T22:00:00.000Z");
		assert.deepEqual(embed.fields, [
			{
				inline: false,
				name: "📆 September 2026",
				value: "🎉 **Today!** - <@today-id> (Alice Display)",
			},
			{
				inline: false,
				name: "📆 October 2026",
				value: "02 Oct 1992 — ⏳ 28 day(s) left • Unknown (Bob)\n"
					+ "20 Oct 1991 — ⏳ 46 day(s) left • <@later-id> (Carol Display)",
			},
		]);
	}
	finally {
		context.mock.timers.reset();
		if (originalTimezone === undefined) delete process.env.TZ;
		else process.env.TZ = originalTimezone;
	}
});

test("birthday scheduling checks at startup and every five minutes", async () => {
	const scheduled = [];
	const reminders = [];
	const logs = [];
	const client = { user: { id: "bot-id" } };

	const stop = startBirthdayScheduledEvent(client, {
		birthdayReminderMessage: async (receivedClient) => {
			reminders.push(receivedClient);
		},
		info: (...args) => {
			logs.push(args);
		},
		schedule: (expression, callback) => {
			scheduled.push({ callback, expression });
		},
	});

	assert.equal(scheduled.length, 1);
	assert.equal(scheduled[0].expression, "*/5 * * * *");
	assert.match(logs[0][0], /checking on startup and every five minutes; due after 9 AM/);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(reminders, [client]);

	await scheduled[0].callback();
	assert.deepEqual(reminders, [client, client]);
	await stop();
});

test("node-cron v4 schedules recovery checks and observes asynchronous reminder failures", async (context) => {
	const { default: cron } = await import("node-cron");
	context.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 5, 8, 0, 0) });
	const client = {};
	const reminders = [];
	const failures = [];
	const reminderError = new Error("reminder failed");
	let shouldFail = false;
	let task;

	try {
		startBirthdayScheduledEvent(client, {
			birthdayReminderMessage: async (receivedClient) => {
				await Promise.resolve();
				if (shouldFail) throw reminderError;
				reminders.push(receivedClient);
			},
			info: () => undefined,
			schedule: (expression, callback) => {
				task = cron.schedule(expression, callback, {
					logger: {
						debug: () => undefined,
						error: () => undefined,
						info: () => undefined,
						warn: () => undefined,
					},
				});
				task.on("execution:failed", (event) => failures.push(event.execution.error));
				return task;
			},
		});

		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(reminders, [client]);
		assert.equal(task.getNextRun().getTime(), new Date(2026, 8, 5, 8, 5, 0).getTime());
		await task.execute();
		assert.deepEqual(reminders, [client, client]);
		shouldFail = true;
		await assert.rejects(task.execute(), reminderError);
		assert.deepEqual(failures, [reminderError]);
	}
	finally {
		await task?.destroy();
	}
});
