/**
 * @file discordRecovery.test.js
 * @description Tests gateway outage classification, lifecycle cleanup and bounded startup readiness.
 * Uses local event emitters and fake clocks without opening Discord connections.
 *
 * @module discordRecoveryTests
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { Events } from "discord.js";
import { watchDiscordGateway } from "../core/discordGatewayHealth.ts";
import { loginClient } from "../core/loginClient.ts";
import { currentLogGuild, withLogGuild } from "../core/logContext.ts";

function gateway() {
	const client = new EventEmitter();
	const records = [];
	const log = Object.fromEntries(["warn", "error", "success", "debug"].map((level) => [level, (...args) => records.push({ level, args, guild: currentLogGuild() })]));
	const stop = watchDiscordGateway(client, { log, now: () => Date.now() });
	return { client, records, stop };
}

test("transient gateway failures are grouped, scoped and followed by one recovery with duration", (context) => {
	context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
	const f = gateway();
	try {
		f.client.emit(Events.ShardReady, 0);
		withLogGuild("another-server", () => {
			for (let index = 0; index < 5; index++) {
				f.client.emit(Events.ShardError, new Error("Opening handshake has timed out"), 0);
				f.client.emit(Events.ShardReconnecting, 0);
			}
		});
		assert.equal(f.records.filter((record) => record.level === "warn").length, 1);
		assert.match(f.records.find((record) => record.level === "warn").args.join(" "), /Discord connection interrupted; trying to reconnect.*Discord took too long to answer/);
		assert.ok(f.records.every((record) => record.guild === undefined));
		assert.ok(!f.records.some((record) => record.level === "error"));
		context.mock.timers.tick(2000);
		f.client.emit(Events.ShardResume, 0, 4);
		f.client.emit(Events.ShardReady, 0);
		const recovered = f.records.filter((record) => record.level === "success");
		assert.equal(recovered.length, 1);
		assert.match(recovered[0].args.join(" "), /Connected to Discord again.*time disconnected: 2000 ms.*attempts: 5.*failures: 5/);
		context.mock.timers.tick(300000);
		assert.ok(!f.records.some((record) => record.level === "error"));
	}
	finally { f.stop(); }
});

test("persistent outages escalate once; fatal and unknown failures are not downgraded", (context) => {
	context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
	const f = gateway();
	try {
		f.client.emit(Events.ShardError, Object.assign(new Error("private network diagnostic"), { code: "ECONNRESET" }), 0);
		context.mock.timers.tick(60000);
		f.client.emit(Events.ShardReconnecting, 0);
		assert.equal(f.records.filter((record) => record.level === "warn").length, 2);
		context.mock.timers.tick(240000);
		assert.equal(f.records.filter((record) => record.level === "error").length, 1);
		context.mock.timers.tick(300000);
		assert.equal(f.records.filter((record) => record.level === "error").length, 1);
		f.client.emit(Events.ShardDisconnect, { code: 4014 }, 1);
		f.client.emit(Events.ShardDisconnect, { code: 4014 }, 1);
		f.client.emit(Events.ShardError, new Error("unknown programming failure"), 2);
		assert.equal(f.records.filter((record) => record.level === "error").length, 3);
		assert.match(JSON.stringify(f.records), /Discord code: 4014/);
		assert.doesNotMatch(JSON.stringify(f.records), /private network diagnostic/);
	}
	finally { f.stop(); }
});

test("known network failures have plain explanations without exposing raw diagnostics", () => {
	const reasons = {
		ECONNRESET: "the connection closed unexpectedly",
		ECONNREFUSED: "the connection was refused",
		ETIMEDOUT: "the connection took too long",
		ENETUNREACH: "the network could not be reached",
		EHOSTUNREACH: "Discord could not be reached",
		EAI_AGAIN: "Discord's network address could not be found right now",
		ENOTFOUND: "Discord's network address could not be found",
	};
	for (const [code, explanation] of Object.entries(reasons)) {
		const f = gateway();
		try {
			f.client.emit(Events.ShardError, Object.assign(new Error("private raw diagnostic"), { code }), 0);
			assert.equal(f.records.length, 1);
			assert.equal(f.records[0].level, "warn");
			assert.ok(f.records[0].args.includes(`reason: ${explanation} (${code})`));
			assert.doesNotMatch(f.records[0].args.join(" "), /private raw diagnostic/);
		}
		finally { f.stop(); }
	}
	const f = gateway();
	try {
		f.client.emit(Events.ShardError, Object.assign(new Error("unknown error"), { code: "constructor" }), 0);
		assert.equal(f.records[0].level, "error");
	}
	finally { f.stop(); }
});

test("gateway shutdown clears pending escalation and removes only owned listeners", (context) => {
	context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
	const f = gateway();
	const unrelated = () => undefined;
	f.client.on(Events.ShardResume, unrelated);
	f.client.emit(Events.ShardReconnecting, 0);
	f.stop();
	f.stop();
	context.mock.timers.tick(600000);
	assert.deepEqual(f.client.listeners(Events.ShardResume), [unrelated]);
	assert.equal(f.client.listenerCount(Events.ShardError), 0);
	assert.ok(!f.records.some((record) => record.level === "error"));
});

test("startup awaits actual readiness whether ready arrives before or after login resolves", async () => {
	const previous = process.env.TOKEN;
	process.env.TOKEN = "synthetic-token";
	try {
		for (const readyFirst of [true, false]) {
			const client = new EventEmitter();
			client.isReady = () => false;
			let finishLogin;
			client.login = () => new Promise((resolve) => { finishLogin = resolve; });
			let complete = false;
			const operation = loginClient(client).then(() => { complete = true; });
			if (readyFirst) client.emit(Events.ClientReady);
			else finishLogin();
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(complete, false);
			if (readyFirst) finishLogin();
			else client.emit(Events.ClientReady);
			await operation;
			assert.equal(client.listenerCount(Events.ClientReady), 0);
		}
	}
	finally {
		if (previous === undefined) delete process.env.TOKEN;
		else process.env.TOKEN = previous;
	}
});

test("readiness timeout and login rejection remove listeners without starting a second login", async () => {
	const previous = process.env.TOKEN;
	process.env.TOKEN = "synthetic-token";
	try {
		for (const failure of [false, true]) {
			const client = new EventEmitter();
			client.isReady = () => false;
			let attempts = 0;
			client.login = async () => {
				attempts++;
				if (failure) throw new Error("login failed");
			};
			await assert.rejects(loginClient(client, 5), failure ? /login failed/ : /Connecting to Discord timed out/);
			assert.equal(client.listenerCount(Events.ClientReady), 0);
			assert.equal(attempts, 1);
		}
	}
	finally {
		if (previous === undefined) delete process.env.TOKEN;
		else process.env.TOKEN = previous;
	}
});
