/**
 * @file service.mjs
 * @description Serves FxEmbed's own cards on one public origin with bounded anonymous access.
 * Keeps metadata APIs, account credentials, client cookies, and arbitrary proxy targets private.
 *
 * @module publicFxService
 */

import { publicFxRoute } from "./routing.mjs";

export function createPublicFxService(app, origin, now = Date.now) {
	let active = 0;
	let windowStart = now();
	let requests = 0;
	const reply = (status, text) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" } });
	return { async fetch(request, _env, context) {
		const input = new URL(request.url);
		const health = input.pathname === "/healthz" && !input.search;
		if (!health && input.host !== new URL(origin).host) return reply(421, "Unknown host");
		if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) return reply(405, "Method not allowed");
		const route = publicFxRoute(input.href);
		if (!route) return reply(404, "Not found");
		if (route.kind === "health") return Response.json({ service: "caitlyn-fxembed-public", ready: true });
		if (route.kind === "index") return reply(200, input.pathname === "/robots.txt" ? "User-agent: *\nAllow: /\n" : "Caitlyn previews · powered by FxEmbed\n");
		if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "Range" } });
		if (now() - windowStart >= 60_000) {
			windowStart = now(); requests = 0;
		}
		if (active >= 8 || ++requests > 180) return reply(429, "Please retry shortly");
		active++;
		let streaming = false;
		try {
			const clean = new URL(route.path + route.search, origin);
			const headers = new Headers({ "User-Agent": (request.headers.get("user-agent") ?? "").slice(0, 512), "x-caitlyn-platform": route.platform });
			const range = request.headers.get("range");
			if (route.kind === "media" && range) {
				if (!/^bytes=\d{0,12}-\d{0,12}$/.test(range) || range === "bytes=-") return reply(416, "Invalid range");
				headers.set("range", range);
			}
			const upstream = await app.fetch(new Request(clean, { headers, signal: request.signal }), {}, context);
			const responseHeaders = new Headers(upstream.headers);
			for (const name of ["set-cookie", "server-timing", "access-control-allow-headers"]) responseHeaders.delete(name);
			responseHeaders.set("x-content-type-options", "nosniff");
			responseHeaders.set("referrer-policy", "no-referrer");
			responseHeaders.set("x-robots-tag", "noindex");
			responseHeaders.set("content-security-policy", "default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
			responseHeaders.set("cache-control", "no-store");
			if (route.kind === "media" && upstream.ok && upstream.body) {
				if (!/^(?:video\/|audio\/|application\/octet-stream)/i.test(responseHeaders.get("content-type") ?? "")
					|| Number(responseHeaders.get("content-length") ?? 0) > 256 * 1_024 * 1_024) {
					await upstream.body.cancel();
					return reply(502, "Media unavailable");
				}
				if (request.method === "HEAD") {
					await upstream.body.cancel();
					return new Response(null, { status: upstream.status, headers: responseHeaders });
				}
				const reader = upstream.body.getReader();
				let bytes = 0;
				let closed = false;
				const release = () => {
					if (!closed) {
						closed = true; active--;
					}
				};
				const timeout = setTimeout(() => { void reader.cancel().then(release, release); }, 120_000);
				streaming = true;
				const body = new ReadableStream({
					async pull(controller) {
						try {
							const chunk = await reader.read();
							if (chunk.done) {
								clearTimeout(timeout); release();
								controller.close(); return;
							}
							bytes += chunk.value.byteLength;
							if (bytes > 256 * 1_024 * 1_024) throw new Error("media_limit");
							controller.enqueue(chunk.value);
						}
						catch {
							clearTimeout(timeout); release();
							await reader.cancel(); controller.error(new Error("Media unavailable"));
						}
					},
					async cancel() {
						clearTimeout(timeout); release();
						await reader.cancel();
					},
				});
				return new Response(body, { status: upstream.status, headers: responseHeaders });
			}
			const html = responseHeaders.get("content-type")?.includes("text/html");
			const attribution = route.sharedBy ? `&amp;shared_by=${encodeURIComponent(route.sharedBy)}` : "";
			let body = html ? (await upstream.text()).replaceAll(`${origin}/owoembed?`, `${origin}/owoembed?platform=${route.platform}${attribution}&amp;`) : upstream.body;
			if (html && route.sharedBy) {
				// Discord's native activity-card footer comes from og:site_name, not oEmbed.
				// The route only accepts ASCII Discord usernames, so no HTML escaping is needed.
				body = body.replace(/<meta property="og:site_name" content="[^"]*"\s*\/?\s*>/g,
					`<meta property="og:site_name" content="Shared by @${route.sharedBy}"/>`);
			}
			if (route.kind === "oembed" && route.sharedBy && upstream.ok) {
				const metadata = await upstream.json();
				// Keep the standard oEmbed fallback consistent with the native activity card.
				// Both changes are response-local; shared branding must never be mutated.
				body = JSON.stringify({ ...metadata, provider_name: `Shared by @${route.sharedBy}`, provider_url: origin });
			}
			if (html || attribution) responseHeaders.delete("content-length");
			return new Response(request.method === "HEAD" ? null : body, { status: upstream.status, headers: responseHeaders });
		}
		catch { return reply(503, "Preview temporarily unavailable"); }
		finally { if (!streaming) active--; }
	} };
}
