/**
 * @file socialLinks.test.js
 * @description Tests canonical social links, URL-free preview captions, hidden content, and hostile input.
 * Includes the owner's public examples without retrieving or storing their post contents.
 *
 * @module socialLinks.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSocialLinks, parseSocialLink, socialPostCaption } from "../core/socialLinks.ts";

test("the owner's X examples preserve string IDs and collapse media-suffix aliases", () => {
	const urls = [
		"https://x.com/TheHiddenOneAC/status/2097940988492664992",
		"https://x.com/HeyShuggie/status/2097725753634755034",
		"https://x.com/iClipCx/status/2097745425323209202/video/1",
		"https://x.com/iClipCx/status/2097745425323209202",
		"https://x.com/MasterLeytrx/status/2097877698894770267",
		"https://x.com/The_Kurieta/status/2097925042214457837",
	];
	const links = extractSocialLinks(urls.join("\n"));
	assert.equal(links.length, 5);
	assert.deepEqual(links.map((link) => link.id), ["2097940988492664992", "2097725753634755034", "2097745425323209202", "2097877698894770267", "2097925042214457837"]);
	assert.equal(links[2].url, urls[3]);
	assert.ok(links.every((link) => link.platform === "x" && link.kind === "post"));
});

test("the owner's TikTok and Reddit samples normalize without fetching them", () => {
	const tiktok = parseSocialLink("https://www.tiktok.com/@nicoiscold/video/7675179840605015310?is_from_webapp=1&sender_device=pc");
	assert.equal(tiktok.url, "https://www.tiktok.com/@nicoiscold/video/7675179840605015310");
	assert.equal(tiktok.key, "tiktok:7675179840605015310");
	for (const [url, id] of [
		["https://www.reddit.com/r/MMALabs/comments/1wbll2j/rei_miyamoto_vs_toshizo_man_vs_woman_fight/", "1wbll2j"],
		["https://www.reddit.com/r/classicwow/comments/1wb10d0/closed_dark_portal/", "1wb10d0"],
		["https://www.reddit.com/r/classicwow/comments/1wc5drd/i_have_never_been_this_hyped_for_a_blizzcon_and_i/", "1wc5drd"],
	]) {
		assert.equal(parseSocialLink(url).url, `https://www.reddit.com/comments/${id}/`);
		assert.equal(parseSocialLink(url).key, `reddit:${id}`);
	}
});

test("aliases, mobile links, galleries, and tracking variations share a stable post key", () => {
	for (const url of ["https://X.COM/alice/status/123", "http://mobile.twitter.com/alice/status/123?track=yes#anchor", "https://x.com/i/web/status/123", "https://x.com/i/status/123/photo/2"]) {
		assert.equal(parseSocialLink(url).key, "x:123");
	}
	for (const url of ["https://old.reddit.com/r/test/comments/abc1/title/", "https://redd.it/ABC1?share=yes", "https://www.reddit.com/gallery/abc1"]) {
		assert.equal(parseSocialLink(url).key, "reddit:abc1");
	}
	for (const url of ["https://instagram.com/reel/Ab_-9/", "https://www.instagram.com/p/Ab_-9/?igsh=tracking", "https://instagram.com/alice/reels/Ab_-9/"]) {
		assert.equal(parseSocialLink(url).key, "instagram:Ab_-9");
	}
	assert.equal(parseSocialLink("https://www.instagram.com/P/Ab_-/").url, "https://www.instagram.com/p/Ab_-/");
	assert.equal(parseSocialLink("https://www.tiktok.com/@alice/photo/123").key, "tiktok:123");
});

test("short share links are explicitly unresolved and never treated as post IDs", () => {
	for (const url of ["https://vm.tiktok.com/ZMabc/", "https://vt.tiktok.com/ZMabc/?track=1", "https://www.tiktok.com/t/ZMabc/", "https://www.reddit.com/r/test/s/aBc12/", "https://www.instagram.com/share/reel/aBc12/", "https://www.instagram.com/share/p/aBc12/"]) {
		const link = parseSocialLink(url);
		assert.equal(link.kind, "share", url);
		assert.ok(link.key.includes(":share:"));
		assert.ok(!link.key.includes("https://"));
		assert.ok(!link.url.includes("?"));
	}
	assert.notEqual(parseSocialLink("https://vm.tiktok.com/ABC/").key, parseSocialLink("https://vt.tiktok.com/ABC/").key);
});

test("finds links in prose and Markdown, trims punctuation, and deduplicates destinations", () => {
	const content = "Look: (https://X.COM/alice/status/123), [a post](https://twitter.com/alice/status/123?share=1). Then **https://instagram.com/p/ABC/**!";
	assert.deepEqual(extractSocialLinks(content).map((link) => link.key), ["x:123", "instagram:ABC"]);
});

test("ignores inline and fenced code, spoilers, and explicitly suppressed embeds", () => {
	const url = "https://x.com/alice/status/123";
	for (const hidden of [`\`${url}\``, `\`\`before \` ${url}\`\``, `\`\`\`ts\n${url}\n\`\`\``, `||${url}||`, `<${url}>`, `\`${url}`, `||${url}`, `<${url}`]) {
		assert.deepEqual(extractSocialLinks(hidden), [], hidden);
	}
	assert.deepEqual(extractSocialLinks(`||${url}|| visible https://x.com/bob/status/456`).map((link) => link.key), ["x:456"]);
	assert.deepEqual(extractSocialLinks(`<${url}> ${url}`).map((link) => link.key), ["x:123"]);
});

test("preview captions remove handled X links and their aliases without empty wrappers", () => {
	const url = "https://x.com/alice/status/123";
	for (const content of [url, `${url}?track=1#anchor`, `**${url}**`, `~~${url}~~`, `*${url}*`, `(${url})`, `[${url}]`, `{${url}}`]) {
		assert.equal(socialPostCaption(content), "", content);
	}
	assert.equal(socialPostCaption(`😀 Look at this\n${url}\nhttps://mobile.twitter.com/alice/status/123/video/1?track=1`), "😀 Look at this");
	assert.equal(socialPostCaption(`Before ${url} after`), "Before after");
	assert.equal(socialPostCaption(`Before\n  ${url}  \nAfter`), "Before\nAfter");
	assert.equal(socialPostCaption(`First ${url}\nSecond https://x.com/bob/status/456`), "First \nSecond");
});

test("preview captions preserve Markdown labels and unrelated caption content", () => {
	const url = "https://x.com/alice/status/123";
	assert.equal(socialPostCaption(`Watch [this clip](${url}?share=1)!`), "Watch this clip!");
	assert.equal(socialPostCaption(`**[this clip](${url})**`), "**this clip**");
	assert.equal(socialPostCaption(`[clip](${url}) and [another](https://x.com/bob/status/456)`), "clip and another");
	const kept = "caption @everyone <@555>\n[reference](https://example.com/notes)\nhttps://www.reddit.com/comments/abc/";
	assert.equal(socialPostCaption(`${kept}\n${url}`), kept);
	const hidden = `\`${url}\`\n\`\`\`ts\n  ${url}\n\`\`\`\n||${url}||\n<${url}>`;
	assert.equal(socialPostCaption(`${hidden}\n${url}`), hidden);
	const hostile = "https://x.com.evil.test/alice/status/123 https://example.com/?next=https://x.com/alice/status/123";
	assert.equal(socialPostCaption(`${hostile}\n${url}`), hostile);
	// Keep formats the admission parser does not recognize, rather than silently dropping them.
	for (const unhandled of [`__${url}__`, `_${url}_`, `[${url}](${url})`]) {
		assert.equal(socialPostCaption(unhandled), unhandled);
	}
});

test("preview captions retain links outside the shared five-link admission limit", () => {
	const urls = Array.from({ length: 6 }, (_, index) => `https://x.com/alice/status/${index + 1}`);
	assert.equal(socialPostCaption(urls.join("\n")), urls[5]);
	assert.equal(socialPostCaption([...urls, urls[0]].join("\n")), urls[5]);
	const others = Array.from({ length: 5 }, (_, index) => `https://www.reddit.com/comments/a${index}/`).join("\n");
	assert.equal(socialPostCaption(`${others}\n${urls[0]}`), `${others}\n${urls[0]}`);
	const oversized = `caption ${"a".repeat(20_000)} ${urls[0]}`;
	assert.equal(socialPostCaption(oversized), oversized);
});

test("rejects unsafe authorities, schemes, paths, credentials, and non-post URLs", () => {
	for (const url of [
		"https://x.com.evil.example/alice/status/123", "https://evilx.com/alice/status/123",
		"https://x.com@127.0.0.1/alice/status/123", "https://user:secret@x.com/alice/status/123",
		"https://127.0.0.1/123", "https://100.70.173.118/123", "https://[::1]/123",
		"file:///tmp/media.mp4", "javascript:alert(1)", "//x.com/alice/status/123",
		"https://x.com:5432/alice/status/123", "https://x.com./alice/status/123",
		"https://%78.com/alice/status/123", "https://ｘ.com/alice/status/123",
		"https://x.com/alice/status/%31", "https://x.com/../alice/status/123",
		"https://x.com\\@evil.example/alice/status/123", "https://x.com/alice/sta\ntus/123",
		"https://x.com/alice", "https://x.com/alice/status/123/unrecognized",
		"https://www.instagram.com/stories/alice/123", "https://tiktok.com/@alice",
		"https://reddit.com/r/test/comments/abc/title/commentid/", "https://example.org/?url=https://x.com/alice/status/123",
	]) assert.equal(parseSocialLink(url), null, url);
	assert.deepEqual(extractSocialLinks("prefixhttps://x.com/alice/status/123"), []);
});

test("caps recognized links, input lengths, and preserves the caller's original content", () => {
	const content = Array.from({ length: 20 }, (_, index) => `https://x.com/alice/status/${index + 1}`).join(" ");
	assert.equal(extractSocialLinks(content).length, 5);
	assert.deepEqual(extractSocialLinks(" ".repeat(20_001) + content), []);
	assert.equal(parseSocialLink(`https://x.com/alice/status/1?${"x".repeat(2_048)}`), null);
	assert.equal(content.split(" ").length, 20);
});
