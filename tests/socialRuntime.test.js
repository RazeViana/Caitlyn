/**
 * @file socialRuntime.test.js
 * @description Exercises durable social scheduling, cancellation, recovery, and bounded failure behavior.
 * Injects all external services and checks guild-scoped logs without live bot access.
 *
 * @module socialRuntime.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { ChannelType, MessageFlags } from "discord.js";
import { createSocialRuntime, configuredSocialRuntime } from "../core/socialRuntime.ts";
import { currentLogGuild } from "../core/logContext.ts";
import { socialSourceHash } from "../messages/socialDelivery.ts";
import { normalizeXPost } from "../core/socialXPost.ts";
import { decodeSocialWorkerResult } from "../core/socialWorkerClient.ts";

function fixture(overrides = {}) {
	const calls = [];
	const job = { id: "12345678-1234-1234-1234-123456789abc", guild_id: "111", channel_id: "222", source_id: "333", author_id: "444",
		source_hash: socialSourceHash("https://x.com/alice/status/123"), post_id: "123", url: "https://x.com/alice/status/123", status: "processing", attempts: 1, lease_token: "lease", cancel_requested: false, message_id: null, ...overrides };
	const result = { outcome: "ready", post: { id: "123", url: job.url, author: { name: "Alice", handle: "alice" }, text: "hello", textComplete: true, issues: [], media: [] }, files: [] };
	const store = Object.fromEntries(["settings", "enabled", "configure", "enqueue", "claim", "beginSend", "sent", "finish", "cancelSource", "beginSourceDelete", "sourceReplacements", "finishSourceDelete"].map((method) => [method, async (...args) => {
		calls.push([method, ...args]);
		return method === "claim" ? job : true;
	}]));
	const delivery = Object.fromEntries(["typing", "sourceValid", "send", "find", "remove", "replacementPlan", "deleteSource"].map((method) => [method, async (...args) => {
		calls.push([method, ...args]);
		return method === "sourceValid" ? true : method === "send" ? "555" : undefined;
	}]));
	const logs = [];
	const dependencies = { store, delivery, ready: () => true, now: () => 1_000_000, sendTimeoutMs: 10,
		worker: async () => { calls.push(["worker"]); return result; },
		logger: Object.fromEntries(["debug", "info", "success", "warn", "error"].map((level) => [level, (...args) => { logs.push([level, currentLogGuild(), ...args]); }])) };
	const runtime = createSocialRuntime(dependencies);
	return { runtime, dependencies, job, calls, logs, result, finished: () => calls.filter(([name]) => name === "finish").map((call) => call.slice(2)) };
}

test("idle queue polling logs at most once every five minutes", async () => {
	const f = fixture();
	let now = 0;
	f.dependencies.now = () => now;
	f.dependencies.store.claim = async () => undefined;
	for (now = 0; now < 300_000; now += 5_000) await f.runtime.tick();
	assert.equal(f.logs.length, 1);
	await f.runtime.tick();
	assert.equal(f.logs.length, 2);
	assert.equal(f.logs[0][2], "Social queue idle");
});

test("render diagnostics stay guild-scoped and content-free, including incomplete text-only cards", async () => {
	for (const textComplete of [true, false]) {
		const f = fixture();
		f.result.post.text = "private caption content";
		f.result.post.textComplete = textComplete;
		await f.runtime.tick();
		assert.deepEqual(f.logs.find((entry) => entry[2] === "Social preview rendered"),
			["debug", "111", "Social preview rendered", f.job.id, "embeds=1", "files=0", "text_attachment=false", `complete=${textComplete}`]);
		assert.ok(!JSON.stringify(f.logs).includes(f.result.post.text));
		assert.equal(f.logs.some((entry) => entry[2] === "Social preview is partial"), !textComplete);
		assert.equal(f.calls.find(([name]) => name === "beginSend")[2], textComplete);
		const payload = f.calls.find(([name]) => name === "send")[2];
		assert.equal(payload.embeds[0].footer.text, "Caitlyn preview");
		assert.ok(payload.embeds[0].description.endsWith(`Shared by <@${f.job.author_id}>`));
		assert.ok(!JSON.stringify(payload.embeds).includes(f.job.id));
	}
});

test("quote delivery places the clean footer after the quoted content, without splitting the tweet pair", async () => {
	const f = fixture();
	f.result.post.quote = { state: "available", post: { ...f.result.post, id: "456", url: "https://x.com/bob/status/456", author: { name: "Bob", handle: "bob" }, text: "Quoted content" } };
	await f.runtime.tick();
	const payload = f.calls.find(([name]) => name === "send")[2];
	assert.equal(payload.embeds[0].author.name, "Alice (@alice)");
	assert.equal(payload.embeds[0].footer, undefined);
	assert.ok(!payload.embeds[0].description.includes("Shared by"));
	assert.equal(payload.embeds[1].author.name, "Bob (@bob)");
	assert.ok(payload.embeds[1].description.startsWith("Quoted content"));
	assert.ok(payload.embeds[1].description.endsWith("Shared by <@444>"));
	assert.equal(payload.embeds[1].footer.text, "Caitlyn preview");
	assert.equal(f.calls.find(([name]) => name === "beginSend")[2], true);
});

test("compressed-video diagnostics remain guild-scoped and only complete previews authorize source replacement", async () => {
	for (const complete of [true, false]) {
		const f = fixture();
		f.result.post.text = "private caption not for logs";
		f.result.post.media = [{ id: "456", kind: "video", variants: [] }];
		f.result.files = [{ postId: "123", mediaId: "456", extension: "mp4", data: Buffer.alloc(100), compressed: true }];
		if (!complete) {
			f.result.post.quote = { state: "available", post: { ...f.result.post, id: "789", url: "https://x.com/bob/status/789" } };
			f.result.outcome = "partial";
			f.result.mediaFailures = ["compression_incomplete"];
		}
		await f.runtime.tick();
		assert.deepEqual(f.logs.find((entry) => entry[2] === "Social video compressed to upload budget"),
			["info", "111", "Social video compressed to upload budget", f.job.id]);
		assert.ok(!JSON.stringify(f.logs).includes(f.result.post.text));
		assert.ok(!JSON.stringify(f.logs).includes("https://"));
		assert.equal(f.calls.find(([name]) => name === "beginSend")[2], complete);
	}
});

test("TikTok admission namespaces IDs and skips photo routes without changing X jobs", async () => {
	const f = fixture();
	await f.runtime.enqueue({ guildId: "111", channelId: "222", id: "333", author: { id: "444", bot: false }, channel: { type: ChannelType.GuildText },
		flags: { has: () => false }, createdTimestamp: 1_000_000,
		content: "https://x.com/alice/status/123 https://www.tiktok.com/@creator/video/123 https://vm.tiktok.com/Example/ https://www.tiktok.com/@creator/photo/456" });
	assert.deepEqual(f.calls.filter(([method]) => method === "enqueue").map(([, job]) => job.post_id).slice(0, 2), ["123", "tiktok:123"]);
	assert.equal(f.calls.filter(([method]) => method === "enqueue").length, 3);
});

test("TikTok sends only after canonical alias resolution and reuses confirmed siblings without resending", async () => {
	for (const resolution of ["send", "reused", "blocked", "stale"]) {
		const f = fixture({ url: "https://vm.tiktok.com/Example/", post_id: "tiktok:share:fixture" });
		f.result.provider = "tiktok";
		f.result.post = { platform: "tiktok", id: "123", url: "https://www.tiktok.com/@creator/video/123", author: { name: "Creator", handle: "creator" },
			text: "caption", textComplete: true, issues: [], media: [{ id: "123", kind: "video", variants: [] }] };
		f.result.outcome = "partial";
		f.dependencies.store.resolveTikTok = async (job, url) => {
			assert.equal(job.id, f.job.id);
			assert.equal(url, f.result.post.url);
			return resolution;
		};
		await f.runtime.tick();
		assert.equal(f.calls.some(([name]) => name === "send"), resolution === "send");
		assert.equal(f.calls.some(([name]) => name === "beginSend"), resolution === "send");
		if (resolution === "send") assert.equal(f.calls.find(([name]) => name === "beginSend")[2], false);
		if (resolution === "blocked") assert.deepEqual(f.finished().at(-1), ["failed", "duplicate_unconfirmed"]);
		assert.ok(f.logs.some((entry) => entry.includes("mode=tiktok")));
	}
});

test("provider selection is logged privately using only trusted modes on success and failure", async () => {
	for (const provider of ["fxembed", "vxtwitter", "direct", "secret provider text", ["fxembed"]]) {
		for (const failed of [false, true]) {
			const f = fixture();
			f.dependencies.worker = async () => failed ? { outcome: "restricted", provider } : { ...f.result, provider };
			await f.runtime.tick();
			const mode = f.logs.find((entry) => entry[2] === "Social extraction provider mode");
			if (provider === "fxembed") {
				assert.deepEqual(mode, ["info", "111", "Social extraction provider mode", f.job.id, `mode=${provider}`]);
			}
			else {
				assert.equal(mode, undefined);
			}
			assert.ok(!JSON.stringify(f.logs).includes("secret"));
			if (failed) assert.ok(!f.calls.some(([name]) => ["send", "deleteSource"].includes(name)));
		}
	}
});

test("untrusted backend retrieval traces never reach the private log", async () => {
	const f = fixture();
	f.dependencies.worker = async () => ({ outcome: "restricted", retrieval: { cookie: "never-log" } });
	await f.runtime.tick();
	assert.ok(!JSON.stringify(f.logs).includes("never-log"));
});

test("source cleanup starts only after durable completion and never resends after a deletion timeout", async () => {
	const f = fixture({ status: "sent", source_cleanup: "pending", replacement_ready: true });
	f.dependencies.delivery.replacementPlan = async () => ["123"];
	f.dependencies.delivery.deleteSource = async () => { throw new Error("lost deletion acknowledgement"); };
	await f.runtime.tick();
	assert.ok(f.calls.some(([name]) => name === "beginSourceDelete"));
	assert.deepEqual(f.finished().at(-1), ["sent", "source_delete_uncertain"]);
	assert.ok(!f.calls.some(([name]) => ["worker", "send", "remove", "finishSourceDelete"].includes(name)));
	f.job.source_cleanup = "deleting";
	f.dependencies.delivery.sourceValid = async () => assert.fail("original need not exist during recovery");
	f.dependencies.delivery.deleteSource = async () => "deleted";
	await f.runtime.tick();
	assert.equal(f.calls.at(-1)[0], "finishSourceDelete");
	assert.equal(f.calls.at(-1)[2], "deleted");
	f.job.source_cleanup = "deleted";
	await f.runtime.tick();
	assert.deepEqual(f.finished().at(-1), ["sent", "source_deleted"]);
});

test("incomplete replacements retain originals and missing sibling completions delay deletion", async () => {
	const f = fixture({ status: "sent", source_cleanup: "pending", replacement_ready: false });
	await f.runtime.tick();
	assert.ok(f.calls.some(([name, , outcome]) => name === "finishSourceDelete" && outcome === "retained"));
	assert.ok(!f.calls.some(([name]) => name === "beginSourceDelete"));
	const waiting = fixture({ status: "sent", source_cleanup: "pending", replacement_ready: true });
	waiting.dependencies.delivery.replacementPlan = async () => ["123", "456"];
	waiting.dependencies.store.beginSourceDelete = async () => false;
	await waiting.runtime.tick();
	assert.ok(!waiting.calls.some(([name]) => ["deleteSource", "finishSourceDelete"].includes(name)));
});

test("public sensitive parent and quoted posts are requested and delivered without a channel-age gate", async () => {
	for (const quoted of [false, true]) {
		const f = fixture();
		f.dependencies.worker = async (input) => {
			assert.equal(input.allowSensitive, true);
			return f.result;
		};
		if (quoted) f.result.post.quote = { state: "available", post: { ...f.result.post, id: "456", sensitive: true } };
		else f.result.post.sensitive = true;
		await f.runtime.tick();
		assert.equal(f.calls.find(([name]) => name === "beginSend")[3], true);
		assert.ok(f.calls.some(([name]) => name === "sent"));
		assert.deepEqual(f.finished(), []);
	}
});

test("social delivery preflights twice, persists its send claim, and logs in the owning guild", async () => {
	const f = fixture();
	await f.runtime.tick();
	assert.deepEqual(f.calls.map(([name]) => name), ["claim", "enabled", "sourceValid", "typing", "worker", "sourceValid", "beginSend", "send", "sent"]);
	const payload = f.calls.find(([name]) => name === "send")[2];
	assert.equal(payload.embeds[0].footer.text, "Caitlyn preview");
	assert.ok(!JSON.stringify(payload.embeds).includes(f.job.id));
	assert.deepEqual(payload.allowedMentions.parse, []);
	assert.ok(f.logs.every((entry) => entry[1] === "111"));
});

test("database failures and unacknowledged or lost send claims never authorize a send", async () => {
	for (const method of ["claim", "enabled", "beginSend"]) {
		const f = fixture();
		f.dependencies.store[method] = async () => { throw new Error("secret database detail"); };
		await f.runtime.tick();
		assert.ok(!f.calls.some(([name]) => name === "send"));
		assert.ok(!JSON.stringify(f.logs).includes("secret"));
		if (method === "beginSend") assert.equal(f.finished()[0][0], "uncertain");
	}
	const f = fixture();
	f.dependencies.store.beginSend = async () => false;
	await f.runtime.tick();
	assert.ok(!f.calls.some(([name]) => name === "send"));
});

test("worker outages retry at most three times while restricted, invalid, and rate-limited posts stop", async () => {
	for (const outcome of ["worker_unavailable", "timeout", "restricted", "rate_limited", "unavailable", "invalid_response"]) {
		for (const attempts of [1, 3]) {
			const f = fixture({ attempts });
			f.dependencies.worker = async () => ({ outcome });
			await f.runtime.tick();
			assert.deepEqual(f.finished(), [[attempts < 3 && ["worker_unavailable", "timeout"].includes(outcome) ? "queued" : "failed", outcome]]);
			assert.ok(!f.calls.some(([name]) => name === "send"));
		}
	}
});

test("X metadata failures reach private guild logs without sending, deleting, or retrying the original", async () => {
	for (const raw of [
		{ __typename: "TweetTombstone" }, { __typename: "TweetUnavailable", reason: "NsfwLoggedOut" },
		{ __typename: "TweetTombstone", tombstone: { richText: { text: "This Post was deleted. secret" } } },
		{ __typename: "Unexpected private provider value" },
	]) {
		const f = fixture({ source_cleanup: "pending" });
		const normalized = normalizeXPost({ tweetResult: { result: raw } }, "123", true);
		f.dependencies.worker = async (input) => decodeSocialWorkerResult({ ...normalized, diagnostic: { ...normalized.diagnostic, raw: "secret" } }, input);
		await f.runtime.tick();
		assert.deepEqual(f.finished(), [["failed", normalized.outcome]]);
		assert.ok(!f.calls.some(([name]) => ["send", "beginSend", "deleteSource", "beginSourceDelete", "remove"].includes(name)));
		const warning = f.logs.find(([level]) => level === "warn");
		assert.equal(warning[1], "111");
		assert.deepEqual(JSON.parse(warning.at(-1)), normalized.diagnostic);
		assert.ok(!JSON.stringify(f.logs).includes("secret"));
		assert.ok(!JSON.stringify(f.logs).includes("private provider value"));
	}
});

test("runtime revalidates diagnostics before logging even with an injected worker", async () => {
	const f = fixture();
	f.dependencies.worker = async () => ({ outcome: "unavailable", diagnostic: { reason: "secret" } });
	await f.runtime.tick();
	assert.deepEqual(f.finished(), [["failed", "unavailable"]]);
	assert.ok(!JSON.stringify(f.logs).includes("secret"));
});

test("source changes during extraction and disabled settings cancel without sending", async () => {
	for (const stage of ["settings", "source", "worker"]) {
		const f = fixture();
		if (stage === "settings") f.dependencies.store.enabled = async () => false;
		if (stage === "source") f.dependencies.delivery.sourceValid = async () => false;
		if (stage === "worker") {
			f.dependencies.worker = async () => {
				f.dependencies.delivery.sourceValid = async () => false;
				return f.result;
			};
		}
		await f.runtime.tick();
		assert.equal(f.finished()[0][0], "cancelled");
		assert.ok(!f.calls.some(([name]) => name === "send"));
	}
});

test("uncertain sends reconcile or remain uncertain without calling the worker or sending again", async () => {
	for (const confirmed of [true, false]) {
		const f = fixture({ status: "uncertain" });
		f.dependencies.delivery.find = async () => confirmed ? "555" : undefined;
		await f.runtime.tick();
		assert.ok(!f.calls.some(([name]) => ["send", "worker"].includes(name)));
		if (confirmed) assert.equal(f.calls.at(-1)[0], "sent");
		else assert.deepEqual(f.finished(), [["uncertain", "send_not_confirmed"]]);
	}
	const f = fixture();
	f.dependencies.delivery.send = async () => { throw new Error("network reset after acceptance"); };
	await f.runtime.tick();
	assert.equal(f.finished()[0][0], "uncertain");
});

test("a timed-out Discord send records late success without an unhandled rejection or resend", async () => {
	const f = fixture();
	let complete;
	f.dependencies.delivery.send = () => new Promise((resolve) => { complete = resolve; });
	// Keep the test alive because the application's deadline deliberately does not keep the process alive.
	const keepAlive = setInterval(() => undefined, 100);
	try { await f.runtime.tick(); }
	finally { clearInterval(keepAlive); }
	assert.equal(f.finished()[0][0], "uncertain");
	complete("555");
	await setImmediate();
	assert.equal(f.calls.at(-1)[0], "sent");
});

test("sent previews are rechecked and only scheduled for removal when the original changed", async () => {
	const f = fixture({ status: "sent", message_id: "555" });
	f.dependencies.delivery.sourceValid = async () => false;
	await f.runtime.tick();
	assert.deepEqual(f.finished(), [["removing", "source_changed"]]);
	f.job.status = "removing";
	await f.runtime.tick();
	assert.deepEqual(f.finished().at(-1), ["cancelled", "preview_removed"]);
	assert.ok(!f.calls.some(([name]) => name === "send"));
});

test("queue processing is single-flight and shutdown aborts active extraction", async () => {
	const f = fixture();
	let started;
	const extracting = new Promise((resolve) => { started = resolve; });
	f.dependencies.worker = (_request, signal) => new Promise((resolve) => {
		started();
		signal.addEventListener("abort", () => { resolve(f.result); }, { once: true });
	});
	const first = f.runtime.tick();
	await extracting;
	await f.runtime.tick();
	assert.equal(f.calls.filter(([name]) => name === "claim").length, 1);
	await f.runtime.stop();
	await first;
	assert.ok(!f.calls.some(([name]) => name === "send"));
	await f.runtime.tick();
	assert.equal(f.calls.filter(([name]) => name === "claim").length, 1);
});

test("Instagram failure logs use only allowlisted reasons and never leak provider text", async () => {
	for (const reason of ["page_metadata_missing", "http_429", "secret provider text", {}, []]) {
		const f = fixture({ post_id: "instagram:DdUCjIygdfq", url: "https://www.instagram.com/p/DdUCjIygdfq/" });
		f.dependencies.worker = async () => ({ outcome: "unavailable", provider: "instagram", instagramReason: reason });
		await f.runtime.tick();
		assert.equal(f.calls.some(([name]) => name === "send" || name === "deleteSource"), false);
		const warning = f.logs.find((entry) => entry[2] === "Social extraction unavailable; original preserved");
		assert.equal(warning[1], "111");
		assert.equal(warning.some((entry) => typeof entry === "string" && entry.startsWith("instagram_reason=")), ["page_metadata_missing", "http_429"].includes(reason));
		assert.ok(!JSON.stringify(f.logs).includes("secret provider text"));
	}
});

test("explicit Instagram restrictions send one durably claimed notice that can never replace the original", async () => {
	for (const instagramReason of ["private_post", "login_required", "http_401"]) {
		const f = fixture({ post_id: "instagram:DdUCjIygdfq", url: "https://www.instagram.com/p/DdUCjIygdfq/", source_cleanup: "pending" });
		f.dependencies.worker = async () => ({ provider: "instagram", outcome: "restricted", instagramReason });
		await f.runtime.tick();
		assert.deepEqual(f.calls.find(([name]) => name === "beginSend").slice(2), [false, false]);
		const sent = f.calls.find(([name]) => name === "send");
		assert.equal(sent[2].embeds[0].footer.text, "Caitlyn preview");
		assert.match(sent[2].embeds[0].description, /original message has been kept/);
		assert.deepEqual(sent[3], { notice: true });
		assert.equal(f.calls.filter(([name]) => name === "sent").length, 1);
		f.job.status = "sent";
		f.job.replacement_ready = false;
		await f.runtime.tick();
		assert.ok(!f.calls.some(([name]) => name === "deleteSource" || name === "beginSourceDelete"));
		assert.deepEqual(f.calls.find(([name]) => name === "finishSourceDelete").slice(2), ["retained"]);
	}
});

test("Instagram access notices require an unchanged source and acknowledged claim; uncertain sends never resend", async () => {
	for (const stage of ["source", "claim", "send"]) {
		const f = fixture({ post_id: "instagram:DdUCjIygdfq", url: "https://www.instagram.com/p/DdUCjIygdfq/" });
		f.dependencies.worker = async () => {
			if (stage === "source") f.dependencies.delivery.sourceValid = async () => false;
			return { provider: "instagram", outcome: "restricted", instagramReason: "login_required" };
		};
		if (stage === "claim") f.dependencies.store.beginSend = async () => false;
		if (stage === "send") f.dependencies.delivery.send = async () => { throw new Error("uncertain acceptance"); };
		await f.runtime.tick();
		assert.ok(!f.calls.some(([name]) => name === "deleteSource"));
		if (stage !== "send") { assert.ok(!f.calls.some(([name]) => name === "send" || name === "sent")); }
		else {
			assert.equal(f.finished()[0][0], "uncertain");
			f.job.status = "uncertain";
			const workerCalls = f.calls.filter(([name]) => name === "worker").length;
			await f.runtime.tick();
			assert.equal(f.calls.filter(([name]) => name === "worker").length, workerCalls);
		}
	}
});

test("only fresh visible supported links in opted-in text channels enter the queue", async () => {
	const f = fixture();
	const message = { guildId: "111", channelId: "222", id: "333", author: { id: "444", bot: false }, channel: { type: ChannelType.GuildText },
		content: "look https://x.com/alice/status/123", flags: { has: () => false }, createdTimestamp: f.dependencies.now() };
	for (const changes of [{ guildId: null }, { author: { bot: true } }, { webhookId: "999" }, { channel: { type: ChannelType.PublicThread } },
		{ createdTimestamp: -2_000_000 }, { flags: { has: (flag) => flag === MessageFlags.SuppressEmbeds } },
		{ content: "||https://x.com/alice/status/123||" }, { content: "https://instagram.com/share/p/abc/" }, { content: "https://www.reddit.com/comments/abc1/" }]) {
		await f.runtime.enqueue({ ...message, ...changes });
	}
	assert.equal(f.calls.length, 0);
	await f.runtime.enqueue(message);
	const queued = f.calls.find(([name]) => name === "enqueue")[1];
	assert.equal(queued.source_hash, socialSourceHash(message.content));
	assert.equal(queued.guild_id, "111");
	await f.runtime.enqueue({ ...message, content: "https://instagram.com/p/DdUCjIygdfq/" });
	const instagram = f.calls.filter(([name]) => name === "enqueue").at(-1)[1];
	assert.equal(instagram.post_id, "instagram:DdUCjIygdfq");
	f.dependencies.store.enabled = async () => false;
	await f.runtime.enqueue(message);
	assert.equal(f.calls.filter(([name]) => name === "enqueue").length, 2);
	await f.runtime.cancel("111", "222", "333");
	assert.deepEqual(f.calls.at(-1), ["cancelSource", "111", "222", "333"]);
});

test("worker integration is absent unless explicitly enabled", () => {
	const previous = process.env.SOCIAL_MEDIA_ENABLED;
	try {
		delete process.env.SOCIAL_MEDIA_ENABLED;
		assert.equal(configuredSocialRuntime({}), undefined);
		process.env.SOCIAL_MEDIA_ENABLED = "false";
		assert.equal(configuredSocialRuntime({}), undefined);
	}
	finally {
		if (previous === undefined) delete process.env.SOCIAL_MEDIA_ENABLED;
		else process.env.SOCIAL_MEDIA_ENABLED = previous;
	}
});

test("accepted jobs wake an idle scheduler immediately and queued jobs drain without five-second gaps", async (context) => {
	context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const f = fixture();
	const queue = [];
	let claims = 0;
	f.dependencies.store.claim = async () => {
		claims++;
		return queue.shift();
	};
	f.dependencies.store.enqueue = async () => {
		queue.push({ ...f.job });
		return true;
	};
	const message = { guildId: "111", channelId: "222", id: "333", author: { id: "444", bot: false }, channel: { type: ChannelType.GuildText },
		content: f.job.url, flags: { has: () => false }, createdTimestamp: f.dependencies.now() };
	f.runtime.start();
	context.mock.timers.tick(1);
	await setImmediate();
	assert.equal(claims, 1);
	await f.runtime.enqueue(message);
	queue.push({ ...f.job, id: "second-job" });
	context.mock.timers.tick(1);
	await setImmediate();
	assert.equal(f.calls.filter(([name]) => name === "worker").length, 1);
	context.mock.timers.tick(1);
	await setImmediate();
	assert.equal(f.calls.filter(([name]) => name === "worker").length, 2);
	context.mock.timers.tick(1);
	await setImmediate();
	assert.equal(claims, 4);
	context.mock.timers.tick(4_999);
	await setImmediate();
	assert.equal(claims, 4);
	context.mock.timers.tick(1);
	await setImmediate();
	assert.equal(claims, 5);
	await f.runtime.stop();
	context.mock.timers.tick(30_000);
	await setImmediate();
	assert.equal(claims, 5);
});

test("a new arrival during extraction never overlaps jobs and starts as soon as the active job settles", async (context) => {
	context.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const f = fixture();
	const queue = [f.job];
	let finish;
	let workers = 0;
	f.dependencies.store.claim = async () => queue.shift();
	f.dependencies.store.enqueue = async () => {
		queue.push({ ...f.job });
		return true;
	};
	f.dependencies.worker = async () => {
		workers++;
		if (workers === 1) await new Promise((resolve) => { finish = resolve; });
		return f.result;
	};
	f.runtime.start();
	context.mock.timers.tick(1);
	await setImmediate();
	await f.runtime.enqueue({ guildId: "111", channelId: "222", id: "334", author: { id: "444", bot: false }, channel: { type: ChannelType.GuildText },
		content: f.job.url, flags: { has: () => false }, createdTimestamp: f.dependencies.now() });
	context.mock.timers.tick(1);
	await setImmediate();
	assert.equal(workers, 1);
	finish();
	await setImmediate();
	context.mock.timers.tick(1);
	await setImmediate();
	assert.equal(workers, 2);
	await f.runtime.stop();
});

test("cooking feedback failure cannot change preview outcomes and timing logs stay content-free", async () => {
	const f = fixture();
	let now = 0;
	f.dependencies.now = () => now;
	f.dependencies.delivery.typing = async () => { throw new Error("private Discord request"); };
	f.dependencies.worker = async () => {
		now = 1_234;
		return f.result;
	};
	f.dependencies.delivery.send = async () => {
		now = 1_500;
		return "555";
	};
	await f.runtime.tick();
	assert.ok(f.calls.some(([name]) => name === "sent"));
	assert.ok(f.logs.some((entry) => entry.includes("duration_ms=1234")));
	assert.ok(f.logs.some((entry) => entry.includes("send_ms=266")));
	assert.ok(!JSON.stringify(f.logs).includes("private Discord request"));
});
