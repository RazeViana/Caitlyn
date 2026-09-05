import assert from "node:assert/strict";
import { test } from "node:test";
import { MessageFlags } from "discord.js";

const addBirthdayCommand = await import("../commands/user/addbirthday.ts");
const removeBirthdayCommand = await import("../commands/user/removebirthday.ts");
const showBirthdaysCommand = await import("../commands/user/showbirthdays.ts");
const { startBirthdayScheduledEvent } = await import("../jobs/birthdayScheduledEvent.ts");

function birthdayInteraction({ day = 28, month = "5", userId = "1234", username = "Alice", year = 1997 } = {}) {
	const replies = [];
	const user = { id: userId, username };
	return {
		interaction: {
			options: {
				getInteger: (name) => name === "day" ? day : year,
				getString: () => month,
				getUser: () => user,
			},
			reply: async (response) => {
				replies.push(response);
			},
		},
		replies,
	};
}

test("addbirthday preserves insert and duplicate-update SQL paths", async (context) => {
	const originalTimezone = process.env.TZ;
	process.env.TZ = "Europe/Amsterdam";
	context.mock.timers.enable({
		apis: ["Date"],
		now: new Date(2026, 8, 4, 0, 0, 0),
	});

	try {
		const insertCalls = [];
		const insert = birthdayInteraction();
		await addBirthdayCommand.execute(insert.interaction, {
			query: async (...args) => {
				insertCalls.push(args);
				return { rows: [] };
			},
		});

		assert.equal(addBirthdayCommand.cooldown, 5);
		assert.equal(addBirthdayCommand.category, "user");
		assert.deepEqual(insertCalls, [
			["SELECT * FROM discord.birthdays WHERE discord_id = 1234"],
			[
				"INSERT INTO discord.birthdays (discord_id, name, dob) VALUES ($1, $2, $3)",
				["1234", "Alice", "1997-05-28"],
			],
		]);
		assert.deepEqual(insert.replies, []);

		const updateCalls = [];
		const update = birthdayInteraction({ userId: "5678", username: "Bob" });
		await addBirthdayCommand.execute(update.interaction, {
			query: async (...args) => {
				updateCalls.push(args);
				return { rows: args[0].startsWith("SELECT") ? [{ discord_id: "5678" }] : [] };
			},
		});

		assert.deepEqual(updateCalls, [
			["SELECT * FROM discord.birthdays WHERE discord_id = 5678"],
			[
				"UPDATE discord.birthdays SET dob = $1, name = $2 WHERE discord_id = $3",
				["1997-05-28", "Bob", "5678"],
			],
		]);
		assert.deepEqual(update.replies, [{
			content: "Birthday updated for <@5678>!",
			flags: MessageFlags.Ephemeral,
		}]);
	}
	finally {
		context.mock.timers.reset();
		if (originalTimezone === undefined) delete process.env.TZ;
		else process.env.TZ = originalTimezone;
	}
});

test("addbirthday preserves year and calendar-date validation", async (context) => {
	const originalTimezone = process.env.TZ;
	process.env.TZ = "Europe/Amsterdam";
	context.mock.timers.enable({
		apis: ["Date"],
		now: new Date(2026, 8, 4, 0, 0, 0),
	});

	try {
		let queryCount = 0;
		const invalidYear = birthdayInteraction({ year: 2028 });
		await addBirthdayCommand.execute(invalidYear.interaction, {
			query: async () => {
				queryCount += 1;
				return { rows: [] };
			},
		});
		assert.deepEqual(invalidYear.replies, [{
			content: "Please provide a valid year.",
			flags: MessageFlags.Ephemeral,
		}]);

		const invalidDate = birthdayInteraction({ day: 29, month: "2", year: 2026 });
		await addBirthdayCommand.execute(invalidDate.interaction, {
			query: async () => {
				queryCount += 1;
				return { rows: [] };
			},
		});
		assert.deepEqual(invalidDate.replies, [{
			content: "Please provide a valid date.",
			flags: MessageFlags.Ephemeral,
		}]);
		assert.equal(queryCount, 0);
	}
	finally {
		context.mock.timers.reset();
		if (originalTimezone === undefined) delete process.env.TZ;
		else process.env.TZ = originalTimezone;
	}
});

test("removebirthday preserves delete and missing-birthday SQL paths", async () => {
	const deleteCalls = [];
	const existing = birthdayInteraction({ userId: "9012", username: "Carol" });
	await removeBirthdayCommand.execute(existing.interaction, {
		query: async (...args) => {
			deleteCalls.push(args);
			return { rows: args[0].startsWith("SELECT") ? [{ discord_id: "9012" }] : [] };
		},
	});

	assert.equal(removeBirthdayCommand.cooldown, 5);
	assert.equal(removeBirthdayCommand.category, "user");
	assert.deepEqual(deleteCalls, [
		["SELECT * FROM discord.birthdays WHERE discord_id = 9012"],
		["DELETE FROM discord.birthdays WHERE discord_id = 9012"],
	]);
	assert.deepEqual(existing.replies, [{
		content: "Birthday reminder for <@9012> has been deleted.",
		flags: MessageFlags.Ephemeral,
	}]);

	const missingCalls = [];
	const missing = birthdayInteraction({ userId: "3456", username: "Dana" });
	await removeBirthdayCommand.execute(missing.interaction, {
		query: async (...args) => {
			missingCalls.push(args);
			return { rows: [] };
		},
	});

	assert.deepEqual(missingCalls, [
		["SELECT * FROM discord.birthdays WHERE discord_id = 3456"],
	]);
	assert.deepEqual(missing.replies, [{
		content: "<@3456> does not have a birthday set.",
		flags: MessageFlags.Ephemeral,
	}]);
});

test("birthday database success does not swallow Discord reply failures", async () => {
	const originalConsoleError = console.error;
	const loggedErrors = [];
	console.error = (...args) => {
		loggedErrors.push(args);
	};

	try {
		const replyError = new Error("reply failed");
		const add = birthdayInteraction();
		add.interaction.reply = async () => {
			throw replyError;
		};
		await assert.rejects(
			addBirthdayCommand.execute(add.interaction, {
				query: async () => ({ rows: [{ discord_id: "1234" }] }),
			}),
			replyError,
		);

		const remove = birthdayInteraction();
		remove.interaction.reply = async () => {
			throw replyError;
		};
		await assert.rejects(
			removeBirthdayCommand.execute(remove.interaction, {
				query: async () => ({ rows: [] }),
			}),
			replyError,
		);
		assert.deepEqual(loggedErrors, []);
	}
	finally {
		console.error = originalConsoleError;
	}
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
		assert.deepEqual(queryCalls, [["SELECT * FROM discord.birthdays"]]);
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

test("birthday scheduling registers 0 9 * * * and dispatches the reminder", async () => {
	const scheduled = [];
	const reminders = [];
	const logs = [];
	const client = { user: { id: "bot-id" } };

	startBirthdayScheduledEvent(client, {
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
	assert.equal(scheduled[0].expression, "0 9 * * *");
	assert.deepEqual(logs, [["Birthday scheduled event started, running every day at 9 AM."]]);
	assert.deepEqual(reminders, []);

	await scheduled[0].callback();
	assert.deepEqual(reminders, [client]);
});

test("node-cron v4 keeps the local 9 AM schedule and observes asynchronous reminder failures", async (context) => {
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

		assert.deepEqual(reminders, []);
		assert.equal(task.getNextRun().getTime(), new Date(2026, 8, 5, 9, 0, 0).getTime());
		await task.execute();
		assert.deepEqual(reminders, [client]);
		shouldFail = true;
		await assert.rejects(task.execute(), reminderError);
		assert.deepEqual(failures, [reminderError]);
	}
	finally {
		await task?.destroy();
	}
});
