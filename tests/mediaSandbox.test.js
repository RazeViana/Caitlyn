/**
 * @file mediaSandbox.test.js
 * @description Tests the local media gateway's exact hosts, public IPv4 gate, and DNS pinning inputs.
 * Uses synthetic DNS answers and never connects to remote media or private services.
 *
 * @module mediaSandbox.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedTunnel, isPublicAddress, resolvePublicHost } from "../scripts/mediaSandbox/gateway.ts";
import { failureCategory, readFxMetadata } from "../scripts/mediaSandbox/worker.ts";

test("media tunnels permit only known provider hosts on HTTPS port 443", () => {
	for (const host of ["x.com", "api.x.com", "cdn.syndication.twimg.com", "video.twimg.com", "www.tiktok.com", "www.instagram.com", "scontent.cdninstagram.com"]) {
		assert.equal(allowedTunnel(`${host}:443`), host);
	}
	for (const authority of ["127.0.0.1:443", "100.70.173.118:443", "[::1]:443", "x.com:5432", "x.com", "x.com.evil.test:443", "evilx.com:443", "user@x.com:443", "x.com.:443", "x.com:443/path", "x.com\r\n:443", "www.reddit.com:443", "discord.com:443"]) {
		assert.equal(allowedTunnel(authority), null, authority);
	}
});

test("media egress always denies hosted VX and Fx metadata services", () => {
	assert.equal(allowedTunnel("api.vxtwitter.com:443"), null);
	assert.equal(allowedTunnel("api.fxtwitter.com:443"), null);
	for (const host of ["vxtwitter.com", "www.vxtwitter.com", "sub.api.vxtwitter.com", "api.vxtwitter.com.evil.test", "api.fixvx.com"]) {
		assert.equal(allowedTunnel(`${host}:443`), null);
		assert.equal(allowedTunnel(`${host}:443`), null);
	}
});

test("media gateway rejects private, special-use, mapped, and IPv6 addresses", () => {
	for (const address of ["0.1.2.3", "10.2.3.4", "100.64.0.1", "100.127.255.254", "127.3.4.5", "169.254.169.254", "172.16.0.1", "172.31.255.254", "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.1.1", "198.51.100.1", "203.0.113.1", "224.1.1.1", "255.255.255.255", "::1", "::ffff:8.8.8.8", "2606:4700:4700::1111", "not-an-ip"]) {
		assert.equal(isPublicAddress(address), false, address);
	}
	for (const address of ["1.1.1.1", "8.8.8.8", "100.63.255.254", "100.128.0.1", "172.15.255.254", "172.32.0.1"]) {
		assert.equal(isPublicAddress(address), true, address);
	}
});

test("DNS validation returns an IP literal and rejects empty or mixed private answer sets", async () => {
	let calls = 0;
	assert.equal(await resolvePublicHost("x.com", async (host, options) => {
		calls++;
		assert.equal(host, "x.com");
		assert.deepEqual(options, { all: true, family: 4 });
		return [{ address: "1.1.1.1", family: 4 }];
	}), "1.1.1.1");
	assert.equal(calls, 1);
	for (const answers of [[], [{ address: "127.0.0.1", family: 4 }], [{ address: "1.1.1.1", family: 4 }, { address: "100.70.173.118", family: 4 }]]) {
		await assert.rejects(resolvePublicHost("x.com", async () => answers), /blocked_address/);
	}
});

test("extractor errors distinguish setup, restrictions, content gaps, and policy limits", () => {
	for (const [message, outcome] of [
		["Usage: yt-dlp: error: no such option", "invalid_extractor_options"],
		["Permission denied", "sandbox_permission_denied"],
		["request timed out", "timeout"],
		["Login required", "login_or_restriction"],
		["HTTP Error 429", "rate_limited"],
		["HTTP Error 403: Forbidden", "access_denied"],
		["No video could be found in this tweet", "no_video_formats"],
		["File is larger than max-filesize", "size_limit"],
		["Video does not pass filter", "duration_limit"],
		["Unexpected extractor failure", "extractor_error"],
	]) assert.equal(failureCategory(message), outcome);
});

test("FxEmbed metadata stdin preserves split Unicode and rejects oversized or malformed JSON", async () => {
	const data = Buffer.from(JSON.stringify({ text: "Hello 💜 世界" }));
	async function* chunks() {
		for (let index = 0; index < data.length; index++) yield data.subarray(index, index + 1);
	}
	assert.deepEqual(await readFxMetadata(chunks()), { text: "Hello 💜 世界" });
	async function* oversized() { yield Buffer.alloc(1024 * 1024 + 1); }
	async function* malformed() { yield Buffer.from("not JSON"); }
	await assert.rejects(() => readFxMetadata(oversized()), /invalid_probe_input/);
	await assert.rejects(() => readFxMetadata(malformed()));
});
