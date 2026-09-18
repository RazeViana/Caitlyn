/**
 * @file discordLogging.test.js
 * @description Tests private main-server logging, owner-only level controls, buffering, and failures.
 * Uses synthetic interactions and service substitutes without connecting to Discord or PostgreSQL.
 *
 * @module discordLogging.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ChannelType, DiscordAPIError, MessageFlags, PermissionFlagsBits } from "discord.js";
import logger, { subscribeLogs } from "../core/logger.ts";
import { withLogGuild, eventLogGuild } from "../core/logContext.ts";
import { createDiscordLogForwarder, logForwarders, redactLog, LogDeliveryFailure } from "../core/discordLogForwarder.ts";
import { guildSettings } from "../core/guildSettings.ts";
import { execute as setup, data } from "../commands/utility/setup.ts";
import { execute as logs } from "../commands/utility/logs.ts";
import { DEFAULT_LOG_TYPES, parseLogTypes } from "../core/logLevels.ts";
import { execute as onboard } from "../events/guildCreate.ts";
import { deployCommands } from "../core/deployCommands.ts";
import { startBot } from "../main.ts";
import { pool } from "../core/createPGPool.ts";
import { createClient } from "../core/createClient.ts";

const settings = (guild, channel, scope = "console", levels = DEFAULT_LOG_TYPES) => ({
	guild_id: guild, log_channel_id: channel, log_scope: scope, log_levels: [...levels],
});
const record = (message, guildId) => ({ timestamp: "2026-09-06 12:00:00", level: "INFO", message, guildId });

function forwarderFixture(rows = []) {
	let receive;
	let now = 0;
	const sent = [];
	const warnings = [];
	const client = { isReady: () => true };
	const dependencies = {
		settings: { list: async () => rows },
		subscribe: (listener) => {
			receive = listener;
			return () => { receive = undefined; };
		},
		now: () => now,
		send: async (destination, content) => { sent.push({ ...destination, content }); },
		diagnostic: (message) => warnings.push(message),
	};
	return {
		client, dependencies, sent, warnings,
		capture: (message, guildId, level = "INFO") => receive?.({ ...record(message, guildId), level }),
		advance: (milliseconds) => { now += milliseconds; },
	};
}

test("logger subscribers receive matching console records and isolated async server context", async (context) => {
	for (const name of ["log", "error", "warn"]) context.mock.method(console, name, () => undefined);
	const received = [];
	const remove = subscribeLogs((entry) => received.push(entry));
	const removeBroken = subscribeLogs(() => { throw new Error("transport failed"); });
	try {
		await Promise.all(["111", "222"].map((guild) => withLogGuild(guild, async () => {
			await new Promise((resolve) => setImmediate(resolve));
			logger.error(`event-${guild}`);
		})));
		logger.error(new Error("system failure"));
		assert.deepEqual(received.map((entry) => entry.guildId), ["111", "222", undefined]);
		assert.ok(received.every((entry) => entry.level === "ERROR" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(entry.timestamp)));
		assert.match(received[2].message, /Error: system failure/);
		assert.equal(eventLogGuild("guildCreate", [{ id: "111" }]), "111");
		assert.equal(eventLogGuild("messageCreate", [{ id: "message-id", guildId: "222" }]), "222");
		assert.equal(eventLogGuild("voiceStateUpdate", [{ guild: { id: "333" } }]), "333");
		assert.equal(eventLogGuild("clientReady", [{ id: "not-a-guild" }]), undefined);
	}
	finally {
		remove();
		removeBroken();
	}
});

test("only the main server receives logs and legacy destinations in other servers are ignored", async () => {
	const fixture = forwarderFixture([settings("111", "112", "server"), settings("222", "223", "server"), settings("333", "334")]);
	const forwarding = createDiscordLogForwarder(fixture.client, fixture.dependencies);
	fixture.capture("startup");
	await forwarding.refresh();
	fixture.capture("first-server", "111");
	fixture.capture("second-server", "222");
	fixture.capture("system health");
	await forwarding.flush();
	assert.equal(fixture.sent.length, 1);
	assert.equal(fixture.sent[0].guild_id, "333");
	assert.match(fixture.sent[0].content, /startup[\s\S]*first-server[\s\S]*second-server[\s\S]*system health/);
	await forwarding.stop();
});

test("redaction removes configured and URL-encoded credentials, bearer headers, URLs, and ANSI codes", () => {
	const text = "\u001b[31msecret+value secret%2Bvalue Bearer abc.def postgresql://user:pass@localhost/db https://user:pass@service.invalid/api\u001b[0m";
	const redacted = redactLog(text, { TOKEN: "secret+value" });
	assert.doesNotMatch(redacted, /secret|abc\.def|user:pass/);
	assert.equal(redacted.includes("\u001b"), false);
	assert.match(redacted, /Bearer \[REDACTED\]/);
	assert.match(redacted, /postgresql:\/\/\[REDACTED\]@localhost/);
});

test("long logs are split safely and fenced without allowing mentions or embedded fences", async () => {
	const fixture = forwarderFixture([settings("111", "112")]);
	const forwarding = createDiscordLogForwarder(fixture.client, fixture.dependencies);
	await forwarding.refresh();
	fixture.capture("😀".repeat(2500) + " ``` @everyone", "111");
	for (let count = 0; count < 5; count++) await forwarding.flush();
	assert.ok(fixture.sent.length > 1);
	assert.ok(fixture.sent.every(({ content }) => content.length <= 2000 && content.isWellFormed()));
	assert.ok(fixture.sent.every(({ content }) => content.split("```").length === 3));
	await forwarding.stop();
});

test("queue overflow, send failures, cooldown, and configuration changes are bounded", async () => {
	const fixture = forwarderFixture([settings("111", "112")]);
	let fail = true;
	const forwarding = createDiscordLogForwarder(fixture.client, {
		...fixture.dependencies,
		send: async (...args) => {
			if (fail) throw new LogDeliveryFailure("retryable");
			await fixture.dependencies.send(...args);
		},
	});
	await forwarding.refresh();
	for (let count = 0; count < 250; count++) fixture.capture(`line-${count}`, "111");
	await forwarding.flush();
	assert.equal(fixture.warnings.length, 1);
	await forwarding.flush();
	assert.equal(fixture.warnings.length, 1);
	fail = false;
	fixture.advance(30_001);
	await forwarding.flush();
	assert.match(fixture.sent[0].content, /Too many logs were waiting to be sent; dropped parts of the log: 50/);
	forwarding.update(settings("111", "113"));
	fixture.capture("new channel only", "111");
	await forwarding.flush();
	assert.equal(fixture.sent.at(-1).log_channel_id, "113");
	assert.doesNotMatch(fixture.sent.at(-1).content, /line-/);
	forwarding.update(settings("111", null));
	fixture.capture("disabled", "111");
	const before = fixture.sent.length;
	await forwarding.stop();
	fixture.capture("stopped", "111");
	assert.equal(fixture.sent.length, before);
});

test("configuration outages retain a bounded startup buffer and recover on refresh", async () => {
	const fixture = forwarderFixture([settings("111", "112", "console")]);
	let unavailable = true;
	const forwarding = createDiscordLogForwarder(fixture.client, {
		...fixture.dependencies,
		settings: { list: async () => {
			if (unavailable) throw new Error("database offline");
			return fixture.dependencies.settings.list();
		} },
	});
	for (let count = 0; count < 150; count++) fixture.capture(`startup-${count}`);
	await forwarding.start();
	assert.equal(fixture.warnings.length, 1);
	unavailable = false;
	await forwarding.refresh();
	await forwarding.flush();
	assert.match(fixture.sent[0].content, /startup-50/);
	assert.doesNotMatch(fixture.sent[0].content, /startup-0\b/);
	await forwarding.stop();
});

function setupFixture(action = "logs", types = "info,warning,error") {
	const replies = [];
	const everyone = { id: "everyone" };
	const member = { id: "bot" };
	const channel = {
		id: "222", guildId: "111", type: ChannelType.GuildText,
		permissionsFor: (subject) => ({ has: () => subject !== everyone }),
		send: async (options) => { replies.push(options); },
	};
	const guild = {
		id: "111", roles: { everyone }, members: { me: member },
		channels: { fetch: async () => channel },
	};
	channel.guild = guild;
	const client = {
		isReady: () => true,
		guilds: { cache: new Map([["111", guild]]) },
		application: { fetch: async () => ({ owner: { id: "operator" } }) },
	};
	const interaction = {
		guildId: "111", channelId: "222", client, user: { id: "operator" },
		memberPermissions: { has: () => true },
		options: { getSubcommand: () => action, getString: () => types, getChannel: () => channel },
		deferred: false, replied: false,
		deferReply: async (options) => { interaction.deferred = true; replies.push(options); },
		editReply: async (content) => { replies.push(content); },
		reply: async (options) => { replies.push(options); },
	};
	return { interaction, channel, guild, client, replies };
}

function mockSettings(context, current) {
	const saved = [];
	context.mock.method(guildSettings, "getMain", async () => current);
	context.mock.method(guildSettings, "save", async (guild, channel, operator) => {
		saved.push({ guild, channel, operator });
		return settings(guild, channel);
	});
	for (const name of ["info", "error", "warn"]) context.mock.method(logger, name, () => undefined);
	return saved;
}

test("owner setup defers privately, saves the main-server channel, and updates the live destination", async (context) => {
	const saved = mockSettings(context);
	const fixture = setupFixture();
	const updates = [];
	logForwarders.set(fixture.client, { update: (value) => updates.push(value) });
	await setup(fixture.interaction);
	assert.equal(data.toJSON().default_member_permissions, String(PermissionFlagsBits.Administrator));
	assert.deepEqual(data.toJSON().contexts, [0]);
	assert.equal(fixture.replies[0].flags, MessageFlags.Ephemeral);
	assert.deepEqual(saved, [{ guild: "111", channel: "222", operator: true }]);
	assert.equal(updates[0].log_channel_id, "222");
	fixture.interaction.memberPermissions.has = () => false;
	await setup(fixture.interaction);
	assert.equal(saved.length, 1);
	fixture.interaction.guildId = null;
	await setup(fixture.interaction);
	assert.equal(saved.length, 1);
});

test("other administrators and servers cannot configure or discover private logging", async (context) => {
	const saved = mockSettings(context, settings("111", "222", "console"));
	for (const action of ["logs", "disable", "status"]) {
		const fixture = setupFixture(action);
		fixture.interaction.user.id = "another-administrator";
		await setup(fixture.interaction);
		assert.match(fixture.replies.at(-1), /application owner/);
		assert.doesNotMatch(fixture.replies.at(-1), /222/);
	}
	assert.equal(saved.length, 0);
	const otherServer = setupFixture();
	otherServer.interaction.guildId = "999";
	await setup(otherServer.interaction);
	assert.match(otherServer.replies.at(-1), /restricted to the configured main server/);
	assert.equal(saved.length, 0);
	const fixture = setupFixture();
	await setup(fixture.interaction);
	assert.equal(saved[0].operator, true);
	fixture.channel.permissionsFor = () => ({ has: () => true });
	await setup(fixture.interaction);
	assert.match(fixture.replies.at(-1), /private channel/);
	assert.equal(saved.length, 1);
});

test("status and disable work, while database and channel permission failures receive safe errors", async (context) => {
	const saved = mockSettings(context, settings("111", "222"));
	const status = setupFixture("status");
	await setup(status.interaction);
	assert.match(status.replies.at(-1), /<#222>/);
	const disabled = setupFixture("disable");
	await setup(disabled.interaction);
	assert.equal(saved[0].channel, null);
	const denied = setupFixture();
	denied.channel.permissionsFor = () => ({ has: () => false });
	await setup(denied.interaction);
	assert.match(denied.replies.at(-1).content, /View Channel\/Send Messages/);
	context.mock.method(guildSettings, "getMain", async () => { throw new Error("secret database error"); });
	const failed = setupFixture();
	await setup(failed.interaction);
	assert.match(failed.replies.at(-1).content, /migrations 011\/012/);
	assert.doesNotMatch(failed.replies.at(-1).content, /secret database error/);
});

test("actual delivery disables mentions, checks guild membership, and stops forwarding a now-public console channel", async () => {
	const fixture = setupFixture();
	let receive;
	const warnings = [];
	const forwarding = createDiscordLogForwarder(fixture.client, {
		settings: { list: async () => [settings("111", "222", "console")] },
		subscribe: (listener) => { receive = listener; return () => undefined; },
		diagnostic: (message) => warnings.push(message),
	});
	await forwarding.refresh();
	receive(record("@everyone test"));
	await forwarding.flush();
	assert.deepEqual(fixture.replies[0].allowedMentions, { parse: [] });
	assert.equal(fixture.replies[0].enforceNonce, true);
	assert.match(fixture.replies[0].nonce, /^[a-f0-9]{24}$/);
	fixture.channel.permissionsFor = () => ({ has: () => true });
	receive(record("must not reach a public channel"));
	await forwarding.flush();
	assert.equal(fixture.replies.length, 1);
	assert.equal(warnings.length, 1);
	await forwarding.stop();
});

test("real log transport distinguishes read failures, definite API rejections and uncertain POST outcomes", async () => {
	for (const kind of ["preflight", "rate_limit", "forbidden", "server_error", "network"]) {
		const fixture = setupFixture();
		let receive;
		let fail = true;
		let now = 0;
		const diagnostics = [];
		const attempts = [];
		fixture.guild.channels.fetch = async () => {
			if (fail && kind === "preflight") throw new Error("private read failure");
			return fixture.channel;
		};
		fixture.channel.send = async (options) => {
			attempts.push(options);
			if (!fail) return;
			if (kind === "network") throw new Error("private transport failure");
			const status = kind === "forbidden" ? 403 : kind === "rate_limit" ? 429 : 500;
			throw new DiscordAPIError({ message: "synthetic", code: 50013 }, 50013, status, "POST", "https://discord.invalid/fixture", {});
		};
		const forwarding = createDiscordLogForwarder(fixture.client, {
			settings: { list: async () => [settings("111", "222")] },
			subscribe: (listener) => { receive = listener; return () => undefined; },
			now: () => now,
			diagnostic: (message) => diagnostics.push(message),
		});
		await forwarding.refresh();
		for (let index = 0; index < 6; index++) receive(record(`transport-original-${index}`));
		await forwarding.flush();
		fail = false;
		now = 30001;
		await forwarding.flush();
		if (["preflight", "rate_limit"].includes(kind)) {
			assert.match(attempts.at(-1).content, /transport-original-0[\s\S]*transport-original-5/);
		}
		else {
			assert.doesNotMatch(attempts.at(-1).content, /transport-original/);
			assert.match(attempts.at(-1).content, kind === "forbidden" ? /Could not send parts of the log: 6/ : /Could not confirm whether parts of the log were sent: 6/);
		}
		assert.doesNotMatch(diagnostics.join(" "), /private (read|transport) failure/);
		await forwarding.stop();
	}
});

test("joining other servers never posts logging setup instructions or chooses a destination", async (context) => {
	mockSettings(context);
	const fixture = setupFixture();
	fixture.guild.client = fixture.client;
	fixture.guild.systemChannel = fixture.channel;
	await onboard(fixture.guild);
	assert.equal(fixture.replies.length, 0);
	assert.equal(logger.info.mock.calls.length, 1);
	fixture.guild.systemChannel = null;
	fixture.guild.fetchOwner = async () => { throw new Error("Owner should never be contacted"); };
	assert.doesNotThrow(() => onboard(fixture.guild));
});

test("global publication is explicit, works without a guild ID, and uses the global route only", async (context) => {
	mockSettings(context);
	const calls = [];
	await deployCommands({ CLIENT_ID: "client", TOKEN: "token" }, {
		global: true,
		rest: { put: async (route, options) => { calls.push({ route, options }); return options.body; } },
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].route, "/applications/client/commands");
	assert.equal(calls[0].options.body.some((command) => ["setup", "logs"].includes(command.name)), false);
	assert.ok(calls[0].options.body.some((command) => command.name === "ping"));
});

test("startup starts forwarding before login and drains it before Discord is destroyed", async () => {
	const calls = [];
	const client = { destroy: async () => calls.push("destroy") };
	const forwarder = {
		start: async () => calls.push("start forwarding"), stop: async () => calls.push("stop forwarding"),
	};
	const runtime = await startBot({
		validateEnvironment: () => undefined, createClient: () => client,
		createLogForwarder: () => forwarder,
		createPGPool: async () => calls.push("database"), closeDatabase: async () => calls.push("close database"),
		commandHandler: async () => undefined, eventHandler: async () => undefined, drainEvents: async () => calls.push("drain"),
		loginClient: async () => calls.push("login"), startCronJobs: () => async () => undefined,
		logger: { info: () => undefined, error: () => undefined },
	});
	await runtime.stop();
	assert.deepEqual(calls, ["database", "start forwarding", "login", "drain", "stop forwarding", "destroy", "close database"]);
	assert.equal(logForwarders.has(client), false);
});

test("shared pool and gateway errors never inherit the triggering server's scope", async (context) => {
	for (const name of ["log", "warn", "error"]) context.mock.method(console, name, () => undefined);
	const records = [];
	const remove = subscribeLogs((value) => records.push(value));
	const client = createClient([]);
	try {
		withLogGuild("111", () => {
			pool.emit("error", new Error("shared database failure"));
			client.emit("shardError", new Error("shared gateway failure"), 0);
		});
		assert.ok(records.filter((value) => value.level === "ERROR").length >= 2);
		assert.ok(records.every((value) => value.guildId === undefined));
	}
	finally {
		remove();
		await client.destroy();
	}
});

test("an outdated refresh cannot replace settings saved while its query was pending", async () => {
	const fixture = forwarderFixture();
	let resolveQuery;
	const forwarding = createDiscordLogForwarder(fixture.client, {
		...fixture.dependencies,
		settings: { list: () => new Promise((resolve) => { resolveQuery = resolve; }) },
	});
	const refresh = forwarding.refresh();
	forwarding.update(settings("111", "new-channel"));
	resolveQuery([settings("111", "old-channel")]);
	await refresh;
	fixture.capture("saved during refresh", "111");
	await forwarding.flush();
	assert.equal(fixture.sent[0].log_channel_id, "new-channel");
	await forwarding.stop();
});

test("pending delivery does not overlap and stopped forwarding releases subscriptions", async () => {
	const fixture = forwarderFixture([settings("111", "112")]);
	let finish;
	let attempts = 0;
	const forwarding = createDiscordLogForwarder(fixture.client, {
		...fixture.dependencies,
		send: () => {
			attempts++;
			return new Promise((resolve) => { finish = resolve; });
		},
	});
	await forwarding.refresh();
	fixture.capture("pending", "111");
	const first = forwarding.flush();
	const second = forwarding.flush();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(attempts, 1);
	finish();
	await Promise.all([first, second]);
	await forwarding.stop();
	fixture.capture("after stop", "111");
	await forwarding.flush();
	assert.equal(attempts, 1);
});

test("disabling a destination while its channel lookup is pending prevents a new send", async () => {
	const fixture = setupFixture();
	let receive;
	let found;
	fixture.guild.channels.fetch = () => new Promise((resolve) => { found = resolve; });
	const forwarding = createDiscordLogForwarder(fixture.client, {
		settings: { list: async () => [settings("111", "222")] },
		subscribe: (listener) => { receive = listener; return () => undefined; },
	});
	await forwarding.refresh();
	receive(record("cancel this send", "111"));
	const flushing = forwarding.flush();
	await new Promise((resolve) => setImmediate(resolve));
	forwarding.update(settings("111", null));
	found(fixture.channel);
	await flushing;
	assert.equal(fixture.replies.length, 0);
	await forwarding.stop();
});

test("log selection accepts exact types, warning aliases, all, and none", () => {
	assert.deepEqual(parseLogTypes("info,Warning,error"), ["INFO", "WARN", "ERROR"]);
	assert.deepEqual(parseLogTypes("debug,debug,warn"), ["DEBUG", "WARN"]);
	assert.deepEqual(parseLogTypes("all"), ["DEBUG", "INFO", "SUCCESS", "WARN", "ERROR"]);
	assert.deepEqual(parseLogTypes("none"), []);
	for (const invalid of ["", "verbose", "info,invalid", "all,error", "none,info"]) {
		assert.throws(() => parseLogTypes(invalid), /Choose debug/);
	}
});

test("forwarding filters exact types, clears queued old levels on changes, and honors none", async () => {
	const fixture = forwarderFixture([settings("111", "112", "console", ["DEBUG", "ERROR"])]);
	const forwarding = createDiscordLogForwarder(fixture.client, fixture.dependencies);
	await forwarding.refresh();
	fixture.capture("visible-debug", undefined, "DEBUG");
	fixture.capture("hidden-info", undefined, "INFO");
	fixture.capture("visible-error", "other-server", "ERROR");
	await forwarding.flush();
	assert.match(fixture.sent[0].content, /visible-debug[\s\S]*visible-error/);
	assert.doesNotMatch(fixture.sent[0].content, /hidden-info/);
	fixture.capture("queued-old-debug", undefined, "DEBUG");
	forwarding.update(settings("111", "112", "console", ["ERROR"]));
	fixture.capture("new-error", undefined, "ERROR");
	await forwarding.flush();
	assert.match(fixture.sent[1].content, /new-error/);
	assert.doesNotMatch(fixture.sent[1].content, /queued-old-debug/);
	forwarding.update(settings("111", "112", "console", []));
	fixture.capture("paused-error", undefined, "ERROR");
	await forwarding.stop();
	assert.equal(fixture.sent.length, 2);
});

test("conflicting or legacy-only destinations never receive forwarded records", async () => {
	for (const rows of [
		[settings("111", "112", "server")],
		[settings("111", "112"), settings("222", "223")],
		[settings("111", "112", "console", ["INVALID"])],
	]) {
		const fixture = forwarderFixture(rows);
		const forwarding = createDiscordLogForwarder(fixture.client, fixture.dependencies);
		await forwarding.refresh();
		fixture.capture("do not expose this", "111");
		await forwarding.stop();
		assert.equal(fixture.sent.length, 0);
	}
});

test("the owner can persist selected levels from the logging channel and inspect them privately", async (context) => {
	mockSettings(context, settings("111", "222"));
	const changes = [];
	context.mock.method(guildSettings, "setLevels", async (guild, channel, levels, operator) => {
		changes.push({ guild, channel, levels, operator });
		return settings(guild, channel, "console", levels);
	});
	const fixture = setupFixture("levels", "debug,warning,error");
	const updates = [];
	logForwarders.set(fixture.client, { update: (value) => updates.push(value) });
	await logs(fixture.interaction);
	assert.equal(fixture.replies[0].flags, MessageFlags.Ephemeral);
	assert.deepEqual(changes, [{ guild: "111", channel: "222", levels: ["DEBUG", "WARN", "ERROR"], operator: true }]);
	assert.deepEqual(updates[0].log_levels, ["DEBUG", "WARN", "ERROR"]);
	assert.match(fixture.replies.at(-1), /Saved for future restarts; console LOG_LEVEL is unchanged/);
	const status = setupFixture("status");
	await logs(status.interaction);
	assert.match(status.replies.at(-1), /info, success, warning, error/);
});

test("log controls reject non-owners, other servers, other channels, and disabled destinations", async (context) => {
	mockSettings(context, settings("111", "222"));
	const write = context.mock.method(guildSettings, "setLevels", async () => { throw new Error("Must not save"); });
	for (const adjust of [
		(value) => { value.interaction.user.id = "other-administrator"; },
		(value) => { value.interaction.guildId = "999"; },
		(value) => { value.interaction.channelId = "999"; },
		(value) => { value.interaction.guildId = null; },
		(value) => { value.interaction.memberPermissions.has = () => false; },
	]) {
		const fixture = setupFixture("levels", "all");
		adjust(fixture);
		await logs(fixture.interaction);
		assert.doesNotMatch(JSON.stringify(fixture.replies), /<#222>|<#[0-9]+>/);
	}
	context.mock.method(guildSettings, "getMain", async () => settings("111", null));
	await logs(setupFixture("levels", "all").interaction);
	assert.equal(write.mock.calls.length, 0);
});

test("invalid levels, missing ownership metadata, and database failures do not update the live filter", async (context) => {
	mockSettings(context, settings("111", "222"));
	const write = context.mock.method(guildSettings, "setLevels", async () => { throw new Error("private database failure"); });
	const invalid = setupFixture("levels", "verbose");
	await logs(invalid.interaction);
	assert.match(invalid.replies.at(-1), /Use comma-separated/);
	assert.equal(write.mock.calls.length, 0);
	const unavailable = setupFixture("levels", "all");
	unavailable.client.application.fetch = async () => { throw new Error("ownership unavailable"); };
	await logs(unavailable.interaction);
	assert.equal(write.mock.calls.length, 0);
	const failed = setupFixture("levels", "all");
	let updated = false;
	logForwarders.set(failed.client, { update: () => { updated = true; } });
	await logs(failed.interaction);
	assert.equal(updated, false);
	assert.match(failed.replies.at(-1).content, /Could not update log levels/);
	assert.doesNotMatch(failed.replies.at(-1).content, /private database failure/);
});
