const assert = require("node:assert/strict");
const { test } = require("node:test");
const { MessageFlags, TextChannel } = require("discord.js");

process.env.TZ = "UTC";
process.env.GENERAL_CHAT_ID = "general-chat-test";
process.env.GIPHY_API_KEY = "giphy-test-key";
process.env.GUILD_ID = "guild-test";

const { pool } = require("../core/createPGPool.ts");
const addBirthday = require("../commands/user/addbirthday.ts");
const removeBirthday = require("../commands/user/removebirthday.ts");
const showBirthdays = require("../commands/user/showbirthdays.ts");
const {
	birthdayReminderMessage,
} = require("../messages/birthdayReminderMessage.ts");

function createBirthdayInteraction() {
	const replies = [];

	return {
		interaction: {
			options: {
				getUser: () => ({ id: "123456", username: "Birthday Person" }),
				getInteger: (name) => name === "day" ? 10 : 2000,
				getString: () => "6",
			},
			reply: async (reply) => replies.push(reply),
		},
		replies,
	};
}

test("addbirthday inserts a new birthday with the original SQL contract", async () => {
	const originalQuery = pool.query;
	const queries = [];
	const fixture = createBirthdayInteraction();

	pool.query = async (...args) => {
		queries.push(args);
		return { rows: [] };
	};

	try {
		await addBirthday.execute(fixture.interaction);

		assert.deepEqual(queries, [
			["SELECT * FROM discord.birthdays WHERE discord_id = 123456"],
			[
				"INSERT INTO discord.birthdays (discord_id, name, dob) VALUES ($1, $2, $3)",
				["123456", "Birthday Person", "2000-06-11"],
			],
		]);
		assert.deepEqual(fixture.replies, []);
	}
	finally {
		pool.query = originalQuery;
	}
});

test("addbirthday updates an existing birthday and replies ephemerally", async () => {
	const originalQuery = pool.query;
	const queries = [];
	const fixture = createBirthdayInteraction();

	pool.query = async (...args) => {
		queries.push(args);
		return {
			rows: queries.length === 1 ? [{ discord_id: "123456" }] : [],
		};
	};

	try {
		await addBirthday.execute(fixture.interaction);

		assert.deepEqual(queries, [
			["SELECT * FROM discord.birthdays WHERE discord_id = 123456"],
			[
				"UPDATE discord.birthdays SET dob = $1, name = $2 WHERE discord_id = $3",
				["2000-06-11", "Birthday Person", "123456"],
			],
		]);
		assert.deepEqual(fixture.replies, [{
			content: "Birthday updated for <@123456>!",
			flags: MessageFlags.Ephemeral,
		}]);
	}
	finally {
		pool.query = originalQuery;
	}
});

test("removebirthday deletes an existing birthday with the original SQL", async () => {
	const originalQuery = pool.query;
	const queries = [];
	const fixture = createBirthdayInteraction();

	pool.query = async (...args) => {
		queries.push(args);
		return { rows: [{ discord_id: "123456" }] };
	};

	try {
		await removeBirthday.execute(fixture.interaction);

		assert.deepEqual(queries, [
			["SELECT * FROM discord.birthdays WHERE discord_id = 123456"],
			["DELETE FROM discord.birthdays WHERE discord_id = 123456"],
		]);
		assert.deepEqual(fixture.replies, [{
			content: "Birthday reminder for <@123456> has been deleted.",
			flags: MessageFlags.Ephemeral,
		}]);
	}
	finally {
		pool.query = originalQuery;
	}
});

test("birthday reminder queries birthdays and sends matching mentions", async () => {
	const originalQuery = pool.query;
	const queries = [];
	const sent = [];
	const now = new Date();
	const channel = Object.create(TextChannel.prototype);
	channel.send = async (message) => sent.push(message);
	const fetched = [];
	const client = {
		guilds: {
			async fetch(id) {
				fetched.push(["guild", id]);
				return {
					channels: {
						async fetch(channelId) {
							fetched.push(["channel", channelId]);
							return channel;
						},
					},
				};
			},
		},
	};

	pool.query = async (...args) => {
		queries.push(args);
		return {
			rows: [{
				discord_id: "birthday-user",
				dob: new Date(
					now.getFullYear() - 20,
					now.getMonth(),
					now.getDate(),
					12,
				),
				name: "Birthday User",
			}],
		};
	};

	try {
		await birthdayReminderMessage(client);

		assert.deepEqual(queries, [["SELECT * FROM discord.birthdays"]]);
		assert.deepEqual(fetched, [
			["guild", "guild-test"],
			["channel", "general-chat-test"],
		]);
		assert.equal(sent.length, 1);
		assert.match(sent[0].content, /\*\*It's Party Time!\*\*/);
		assert.match(sent[0].content, /<@birthday-user>/);
	}
	finally {
		pool.query = originalQuery;
	}
});

test("showbirthdays edits the deferred reply with the birthday embed", async () => {
	const originalFetch = global.fetch;
	const originalQuery = pool.query;
	const edits = [];
	const now = new Date();
	const tomorrow = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() + 1,
		12,
	);
	let deferred = false;

	global.fetch = async (url) => {
		assert.equal(
			url,
			"https://api.giphy.com/v1/gifs/random?api_key=giphy-test-key&tag=birthday",
		);
		return {
			ok: true,
			statusText: "OK",
			async json() {
				return {
					data: { images: { original: { url: "https://gif.test/birthday.gif" } } },
				};
			},
		};
	};
	pool.query = async (...args) => {
		assert.deepEqual(args, ["SELECT * FROM discord.birthdays"]);
		return {
			rows: [{
				discord_id: "birthday-user",
				dob: new Date(
					tomorrow.getFullYear() - 20,
					tomorrow.getMonth(),
					tomorrow.getDate(),
					12,
				),
				name: "Birthday User",
			}],
		};
	};

	const interaction = {
		async deferReply() {
			deferred = true;
		},
		async editReply(reply) {
			edits.push(reply);
		},
		guild: {
			members: {
				async fetch(id) {
					assert.equal(id, "birthday-user");
					return { displayName: "Birthday Display" };
				},
			},
		},
		user: {
			username: "Requester",
			displayAvatarURL: () => "https://avatar.test/requester.png",
		},
	};

	try {
		await showBirthdays.execute(interaction);

		assert.equal(deferred, true);
		assert.equal(edits.length, 1);
		const embed = edits[0].embeds[0].toJSON();
		assert.equal(embed.title, "🎂 Birthday Calendar");
		assert.equal(embed.description, "Here are all the saved birthdays");
		assert.equal(embed.thumbnail.url, "https://gif.test/birthday.gif");
		assert.equal(embed.footer.text, "Requested by Requester");
		assert.equal(embed.fields.length, 1);
		assert.match(embed.fields[0].value, /⏳ 1 day\(s\) left/);
		assert.match(
			embed.fields[0].value,
			/<@birthday-user> \(Birthday Display\)/,
		);
	}
	finally {
		global.fetch = originalFetch;
		pool.query = originalQuery;
	}
});
