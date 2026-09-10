/**
 * @file socialLinks.ts
 * @description Recognizes and deduplicates social-post links without making network requests.
 * Discards tracking parameters and ignores code, spoilers, and explicitly suppressed embeds.
 *
 * @module socialLinks
 */

import { createHash } from "node:crypto";
import type { SocialLink, SocialPlatform } from "../types/socialMedia.js";

const MAX_MESSAGE_LENGTH = 20_000;
const MAX_URL_LENGTH = 2_048;
const MAX_LINKS = 5;

function post(platform: SocialPlatform, id: string, url: string): SocialLink {
	return { platform, kind: "post", id, key: `${platform}:${id}`, url };
}

function share(platform: SocialPlatform, id: string, url: string): SocialLink {
	const fingerprint = createHash("sha256").update(url).digest("hex");
	return { platform, kind: "share", id, key: `${platform}:share:${fingerprint}`, url };
}

/**
 * Validate exact hosts and known routes; this is not a network/SSRF authorization check.
 * Share links require a separately protected resolver before they can become posts.
 */
export function parseSocialLink(input: string): SocialLink | null {
	if (!input || input.length > MAX_URL_LENGTH || /[\s\\\p{Cc}]/u.test(input)) return null;
	let url: URL;
	try {
		url = new URL(input);
	}
	catch {
		return null;
	}
	if (!/^https?:\/\//i.test(input) || !["https:", "http:"].includes(url.protocol)
		|| url.username || url.password || url.port) return null;
	// Reject encoded/normalized authorities and paths rather than repairing ambiguous input.
	const authority = input.match(/^https?:\/\/([^/?#]+)/i)?.[1];
	if (!authority || !/^[a-z0-9.-]+(?::(?:80|443))?$/i.test(authority)
		|| /%|\/(?:\.|\.\.)(?:\/|$)/.test(input.split(/[?#]/, 1)[0])) return null;
	const host = url.hostname;
	const path = url.pathname;
	let match: RegExpMatchArray | null;

	if (["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"].includes(host)) {
		match = path.match(/^\/(?:([a-z0-9_]{1,15})\/status|i\/status|i\/web\/status)\/([1-9]\d{0,24})(?:\/(?:photo|video)\/[1-9]\d?)?\/?$/i);
		if (!match) return null;
		return post("x", match[2], `https://x.com/${match[1] ?? "i"}/status/${match[2]}`);
	}
	if (["instagram.com", "www.instagram.com", "m.instagram.com"].includes(host)) {
		match = path.match(/^\/share\/(p|reel)\/([a-z0-9_-]{1,64})\/?$/i);
		if (match) return share("instagram", match[2], `https://www.instagram.com/share/${match[1].toLowerCase()}/${match[2]}/`);
		match = path.match(/^\/(?:(?:[a-z0-9_.]{1,30})\/)?(p|reel|reels|tv)\/([a-z0-9_-]{1,64})\/?$/i);
		if (match) return post("instagram", match[2], `https://www.instagram.com/${match[1].toLowerCase() === "p" ? "p" : "reel"}/${match[2]}/`);
	}
	if (["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "np.reddit.com", "m.reddit.com"].includes(host)) {
		match = path.match(/^\/(?:r\/[a-z0-9_]{1,50}\/)?comments\/([a-z0-9]{1,16})(?:\/[a-z0-9_%-]+)?\/?$/i)
			?? path.match(/^\/gallery\/([a-z0-9]{1,16})\/?$/i);
		if (match) return post("reddit", match[1].toLowerCase(), `https://www.reddit.com/comments/${match[1].toLowerCase()}/`);
		match = path.match(/^\/r\/([a-z0-9_]{1,50})\/s\/([a-z0-9]{1,32})\/?$/i);
		if (match) return share("reddit", match[2], `https://www.reddit.com/r/${match[1]}/s/${match[2]}/`);
	}
	if (host === "redd.it") {
		match = path.match(/^\/([a-z0-9]{1,16})\/?$/i);
		if (match) return post("reddit", match[1].toLowerCase(), `https://www.reddit.com/comments/${match[1].toLowerCase()}/`);
	}
	if (["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host)) {
		match = path.match(/^\/@([a-z0-9_.]{1,32})\/(video|photo)\/([1-9]\d{0,24})\/?$/i);
		if (match) return post("tiktok", match[3], `https://www.tiktok.com/@${match[1]}/${match[2].toLowerCase()}/${match[3]}`);
		match = path.match(/^\/t\/([a-z0-9]{1,64})\/?$/i);
		if (match) return share("tiktok", match[1], `https://www.tiktok.com/t/${match[1]}/`);
	}
	if (["vm.tiktok.com", "vt.tiktok.com"].includes(host)) {
		match = path.match(/^\/([a-z0-9]{1,64})\/?$/i);
		if (match) return share("tiktok", match[1], `https://${host}/${match[1]}/`);
	}
	return null;
}

function visibleText(content: string): string {
	const output = content.split("");
	const markers = /`+|\|\||<https?:\/\//gi;
	let marker: RegExpExecArray | null;
	while ((marker = markers.exec(content))) {
		const start = marker.index;
		const delimiter = marker[0];
		let end = -1;
		if (delimiter.startsWith("`")) {
			const runs = /`+/g;
			runs.lastIndex = markers.lastIndex;
			let run: RegExpExecArray | null;
			while ((run = runs.exec(content))) {
				if (run[0].length === delimiter.length || (delimiter.length >= 3 && run[0].length > delimiter.length)) {
					end = runs.lastIndex;
					break;
				}
			}
		}
		else {
			const closer = delimiter === "||" ? "||" : ">";
			const position = content.indexOf(closer, markers.lastIndex);
			if (position !== -1) end = position + closer.length;
		}
		// An unfinished hidden/code region stays hidden, rather than revealing a link.
		if (end === -1) end = content.length;
		output.fill(" ", start, end);
		markers.lastIndex = end;
	}
	return output.join("");
}

export function extractSocialLinks(content: string): SocialLink[] {
	if (content.length > MAX_MESSAGE_LENGTH) return [];
	const visible = visibleText(content);
	const links = new Map<string, SocialLink>();
	for (const match of visible.matchAll(/https?:\/\/[^\s<>"'`|]+/gi)) {
		if (match.index > 0 && /[a-z0-9_/@\\]/i.test(visible[match.index - 1])) continue;
		const candidate = match[0].replace(/[.,!?;:)\]}*~]+$/, "");
		const link = parseSocialLink(candidate);
		if (link && !links.has(link.key)) links.set(link.key, link);
		if (links.size === MAX_LINKS) break;
	}
	return [...links.values()];
}
