/**
 * @file fxPublic.test.js
 * @description Tests public preview routing, caller isolation, redirect boundaries and native-card metadata.
 * Uses in-memory responses without accessing a provider or sending Discord messages.
 *
 * @module fxPublic.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedUpstream, guardedUpstreamFetch, publicFxRoute } from "../scripts/fxEmbedPublic/routing.mjs";
import { createPublicFxService } from "../scripts/fxEmbedPublic/service.mjs";
import { publicFxCompose } from "../scripts/fxEmbedPublic/compose.mjs";

const origin = "https://embed.example.com";
function snowcode(data) {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]\":,.-_";
	return [...JSON.stringify(data).slice(1, -1)].map((character) => alphabet.indexOf(character).toString().padStart(2, "0")).join("");
}

test("single-domain routing includes platform-aware activity and oEmbed requests", () => {
	for (const [path, platform] of [["/alice/status/123", "twitter"], ["/@alice/video/123", "tiktok"], ["/t/ZMexample", "tiktok"], ["/reel/AbC_123/", "instagram"]]) {
		assert.equal(publicFxRoute(origin + path).platform, platform);
		const id = platform === "instagram" ? "AbC_123" : "123";
		assert.equal(publicFxRoute(origin + "/api/v1/statuses/" + snowcode({ i: id, f: platform })).platform, platform);
		assert.equal(publicFxRoute(origin + `/owoembed?platform=${platform}&status=${id}`).platform, platform);
	}
	for (const path of ["/2/status/123", "/api/search", "/set_base_redirect", "/profile", "/raw/123", "/api/v1/statuses/99", "/api/v1/statuses/" + snowcode({ i: "123", f: "twitter", p: "localhost" })]) {
		assert.equal(publicFxRoute(origin + path), undefined);
	}
});

test("media targets and each redirect reject private hosts, deceptive suffixes and forwarded credentials", async () => {
	for (const target of ["http://v.tiktokcdn.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://v.tiktokcdn.com.evil.example/a", "https://user:pass@v.tiktokcdn.com/a", "https://v.tiktokcdn.com:8443/a"]) {
		assert.equal(allowedUpstream(target, true), false);
		assert.equal(publicFxRoute(origin + "/proxy?videoId=123&url=" + encodeURIComponent(target)), undefined);
	}
	const calls = [];
	const fetcher = guardedUpstreamFetch(async (request) => {
		calls.push(request);
		return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
	});
	await assert.rejects(fetcher("https://v.tiktokcdn.com/video"), /upstream_origin_rejected/);
	assert.equal(calls.length, 1);
	let redirect = true;
	const crossOrigin = guardedUpstreamFetch(async (request) => {
		if (redirect) {
			redirect = false;
			return new Response(null, { status: 302, headers: { location: "https://other.tiktokcdn.com/video" } });
		}
		assert.equal(request.headers.get("cookie"), null);
		assert.equal(request.headers.get("authorization"), null);
		return new Response("ok");
	});
	assert.equal(await (await crossOrigin("https://v.tiktokcdn.com/video", { headers: { cookie: "secret", authorization: "secret" } })).text(), "ok");
});

test("public front-end strips caller credentials, routes cards and publishes only its own helper URLs", async () => {
	const requests = [];
	const app = { async fetch(request, env) {
		requests.push(request);
		assert.deepEqual(env, {});
		return new Response(`<link href="${origin}/owoembed?status=123&author=alice">`, { headers: { "content-type": "text/html", "set-cookie": "private=value" } });
	} };
	const service = createPublicFxService(app, origin);
	const response = await service.fetch(new Request(origin + "/@alice/video/123", { headers: { cookie: "secret", authorization: "secret", "x-caitlyn-key": "secret", "x-caitlyn-platform": "instagram", "user-agent": "Discordbot/2.0" } }), {}, {});
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("set-cookie"), null);
	assert.match(await response.text(), /owoembed\?platform=tiktok&amp;status=123/);
	assert.equal(requests[0].headers.get("x-caitlyn-platform"), "tiktok");
	for (const name of ["cookie", "authorization", "x-caitlyn-key"]) assert.equal(requests[0].headers.get(name), null);
	assert.equal((await service.fetch(new Request("https://evil.example/alice/status/123"), {}, {})).status, 421);
	assert.equal((await service.fetch(new Request(origin + "/2/status/123"), {}, {})).status, 404);
	assert.equal((await service.fetch(new Request(origin + "/alice/status/123", { method: "POST" }), {}, {})).status, 405);
	assert.equal(requests.length, 1);
	const robots = await service.fetch(new Request(origin + "/robots.txt"), {}, {});
	assert.equal(await robots.text(), "User-agent: *\nAllow: /\n");
	assert.equal(robots.headers.get("x-robots-tag"), "noindex");
});

test("native-card site names and oEmbed fallbacks attribute each sharer without changing post content or other shares", async () => {
	const upstreamMetadata = { provider_name: "Caitlyn · FxEmbed", provider_url: origin, author_name: "Post author", type: "rich", version: "1.0" };
	const activityLink = `<link href='${origin}/users/alice/statuses/${snowcode({ i: "123", f: "twitter" })}' rel='alternate' type='application/activity+json'>`;
	const upstreamHtml = `<head><meta property="og:site_name" content="Caitlyn · FxEmbed"/><meta property="og:title" content="Post author"/>${activityLink}<link href="${origin}/owoembed?status=123&author=alice" type="application/json+oembed"></head>`;
	const seen = [];
	const app = { async fetch(request) {
		const url = new URL(request.url);
		seen.push(url);
		assert.equal(url.searchParams.has("shared_by"), false);
		assert.equal(url.searchParams.has("v"), false);
		if (url.pathname.endsWith("embed")) return Response.json(upstreamMetadata);
		return new Response(upstreamHtml, { headers: { "content-type": "text/html", "content-length": String(Buffer.byteLength(upstreamHtml)) } });
	} };
	const service = createPublicFxService(app, origin);
	for (const [path, platform] of [["/alice/status/123", "twitter"], ["/@alice/video/123", "tiktok"], ["/p/abc", "instagram"]]) {
		const cards = await Promise.all(["real.user", "another_user", undefined].map(async (username) => {
			const card = await service.fetch(new Request(origin + path + (username ? `?shared_by=${username}&v=2` : "")), {}, {});
			assert.equal(card.headers.get("content-length"), null);
			return card.text();
		}));
		assert.match(cards[0], new RegExp(`platform=${platform}&amp;shared_by=real.user&amp;status=123`));
		assert.deepEqual(cards.map((card) => [...card.matchAll(/<meta property="og:site_name" content="([^"]*)"/g)].map((match) => match[1])),
			[["Shared by @real.user"], ["Shared by @another_user"], ["Caitlyn · FxEmbed"]]);
		assert.ok(cards.every((card) => card.includes(activityLink) && card.includes("<meta property=\"og:title\" content=\"Post author\"/>")));
	}
	const names = ["real.user", "another_user", undefined];
	const responses = await Promise.all(names.map(async (username) => {
		const response = await service.fetch(new Request(origin + "/owoembed?platform=tiktok&status=123" + (username ? `&shared_by=${username}` : "")), {}, {});
		assert.equal(response.headers.get("cache-control"), "no-store");
		return response.json();
	}));
	assert.deepEqual(responses.map((value) => value.provider_name), ["Shared by @real.user", "Shared by @another_user", "Caitlyn · FxEmbed"]);
	assert.ok(responses.every((value) => value.author_name === "Post author" && value.type === "rich"));
	assert.equal(upstreamMetadata.provider_name, "Caitlyn · FxEmbed");
	assert.equal(seen.length, 12);
	for (const query of ["shared_by=Bad%20Nickname", "shared_by=%3Cscript%3E", "shared_by=aa&shared_by=bb", "shared_by=aa%0Abb", "shared_by=" + "a".repeat(33)]) {
		assert.equal(publicFxRoute(origin + "/alice/status/123?" + query), undefined);
		assert.equal(publicFxRoute(origin + "/owoembed?status=123&" + query), undefined);
	}
});

test("anonymous request budgets protect the service while health remains available", async () => {
	let now = 0;
	const service = createPublicFxService({ fetch: async () => new Response("ok") }, origin, () => now);
	for (let i = 0; i < 180; i++) assert.equal((await service.fetch(new Request(origin + "/alice/status/123"), {}, {})).status, 200);
	assert.equal((await service.fetch(new Request(origin + "/alice/status/123"), {}, {})).status, 429);
	assert.equal((await service.fetch(new Request("http://127.0.0.1:8787/healthz"), {}, {})).status, 200);
	now = 60_000;
	assert.equal((await service.fetch(new Request(origin + "/alice/status/123"), {}, {})).status, 200);
});

test("public deployment has one pinned service without credentials or host control access", () => {
	const compose = publicFxCompose({ image: "sha256:" + "a".repeat(64), address: "192.168.2.43", port: 3081 });
	const service = compose.services.fxembed;
	assert.deepEqual(Object.keys(compose.services), ["fxembed"]);
	assert.deepEqual(service.ports, ["192.168.2.43:3081:8787"]);
	assert.equal(service.read_only, true);
	assert.equal(service.user, "1000:1000");
	assert.equal(service.volumes, undefined);
	assert.equal(service.environment, undefined);
	assert.equal(service.devices, undefined);
	assert.throws(() => publicFxCompose({ image: "latest", address: "192.168.2.43", port: 3081 }));
});
