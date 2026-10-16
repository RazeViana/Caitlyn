/**
 * @file routing.mjs
 * @description Restricts the public FxEmbed instance to post previews and their supporting endpoints.
 * Routes all supported platforms on one domain, including Discord's activity-card follow-up requests.
 *
 * @module publicFxRouting
 */

const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]\":,.-_";
const platforms = ["twitter", "tiktok", "instagram"];
const numericId = /^[1-9]\d{0,19}$/;
const instagramId = /^[A-Za-z0-9_-]{1,28}$/;
const cdnDomains = ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "tiktok.com", "tiktokv.com", "byteimg.com", "ibytedtos.com", "bytedance.com", "bytedance.net", "musical.ly"];
const upstreamDomains = ["x.com", "twitter.com", "twimg.com", "instagram.com", "cdninstagram.com", "fbcdn.net", ...cdnDomains];

export function allowedUpstream(input, mediaOnly = false) {
	try {
		const url = new URL(input);
		return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
			&& (mediaOnly ? cdnDomains : upstreamDomains).some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
	}
	catch { return false; }
}

function activityPlatform(code) {
	if (!/^\d{2,768}$/.test(code) || code.length % 2) return;
	try {
		let decoded = "";
		for (let offset = 0; offset < code.length; offset += 2) {
			const character = alphabet[Number(code.slice(offset, offset + 2))];
			if (!character) return;
			decoded += character;
		}
		const data = JSON.parse(`{${decoded}}`);
		if (!platforms.includes(data.f) || typeof data.i !== "string" || !(data.f === "instagram" ? instagramId : numericId).test(data.i)
			|| Object.keys(data).some((key) => !["i", "f", "l", "t", "m", "n"].includes(key))
			|| (data.l !== undefined && !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(data.l))
			|| (data.n !== undefined && ![1, 2, 3, 4].includes(data.n))) return;
		return data.f;
	}
	catch { return; }
}

export function publicFxRoute(input) {
	if (input.length > 12_000 || /[\\\p{Cc}]/u.test(input)) return;
	const url = new URL(input);
	const path = url.pathname;
	if (/%|\/\.\.?\//.test(path) || path.startsWith("/2/")) return;
	if (path === "/healthz" && !url.search) return { kind: "health" };
	if (["/", "/robots.txt"].includes(path) && !url.search) return { kind: "index" };
	let platform;
	if (/^\/[a-z0-9_]{1,15}\/status\/[1-9]\d{0,19}\/?$/i.test(path)) platform = "twitter";
	else if (/^\/(?:p|reel)\/[A-Za-z0-9_-]{1,28}\/?$/.test(path)) platform = "instagram";
	else if (/^\/@[a-z0-9_.]{1,32}\/(?:video|photo)\/[1-9]\d{0,19}\/?$/i.test(path) || /^\/t\/[a-z0-9]{1,64}\/?$/i.test(path)) platform = "tiktok";
	if (platform) return { kind: "post", platform, path: path.replace(/\/$/, ""), search: "" };
	const activity = path.match(/^\/api\/v1\/statuses\/(\d+)$/) ?? path.match(/^\/users\/[a-zA-Z0-9_.-]{1,64}\/statuses\/(\d+)$/);
	if (activity && !url.search) {
		platform = activityPlatform(activity[1]);
		if (platform) return { kind: "activity", platform, path: `/api/v1/statuses/${activity[1]}`, search: "" };
	}
	if (["/owoembed", "/oembed"].includes(path)) {
		platform = url.searchParams.get("platform") ?? "twitter";
		const status = url.searchParams.get("status") ?? "";
		if (!platforms.includes(platform) || !(platform === "instagram" ? instagramId : numericId).test(status)
			|| [...url.searchParams.keys()].some((key) => !["platform", "status", "author", "text", "provider"].includes(key))
			|| url.searchParams.getAll("platform").length > 1) return;
		url.searchParams.delete("platform");
		return { kind: "oembed", platform, path: platform === "tiktok" ? "/oembed" : "/owoembed", search: url.search };
	}
	if (path === "/proxy") {
		const target = url.searchParams.get("url");
		const cookies = url.searchParams.get("cookies") ?? "";
		if (!target || target.length > 6_000 || !allowedUpstream(target, true) || !numericId.test(url.searchParams.get("videoId") ?? "")
			|| cookies.length > 2_048 || /[\p{Cc}]/u.test(cookies)
			|| [...url.searchParams.keys()].some((key) => !["url", "cookies", "videoId"].includes(key))
			|| ["url", "cookies", "videoId"].some((key) => url.searchParams.getAll(key).length > 1)) return;
		return { kind: "media", platform: "tiktok", path, search: url.search };
	}
}

/** Check every redirect, including redirects originating from provider metadata or CDN URLs. */
export function guardedUpstreamFetch(fetcher) {
	return async (input, init) => {
		let request = new Request(input, init);
		for (let redirects = 0; redirects <= 5; redirects++) {
			if (!allowedUpstream(request.url)) throw new Error("upstream_origin_rejected");
			const response = await fetcher(new Request(request, {
				redirect: "manual", signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
			}));
			if (![301, 302, 303, 307, 308].includes(response.status) || request.redirect === "manual") return response;
			const location = response.headers.get("location");
			if (!location) return response;
			await response.body?.cancel();
			if (request.redirect === "error" || redirects === 5) throw new Error("upstream_redirect_rejected");
			const next = new URL(location, request.url);
			if (!allowedUpstream(next)) throw new Error("upstream_origin_rejected");
			const headers = new Headers(request.headers);
			if (next.origin !== new URL(request.url).origin) {
				headers.delete("cookie");
				headers.delete("authorization");
			}
			const method = response.status === 303 || ([301, 302].includes(response.status) && request.method === "POST") ? "GET" : request.method;
			request = new Request(next, { method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : request.body, redirect: request.redirect, signal: request.signal, duplex: "half" });
		}
		throw new Error("upstream_redirect_rejected");
	};
}
