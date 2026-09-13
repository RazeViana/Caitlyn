/**
 * @file service.mjs
 * @description Gates local FxEmbed requests before initializing an optional authorized account session.
 * Strips caller headers, hides upstream failures, and keeps all responses out of browser caches.
 *
 * @module fxEmbedService
 */

const secretNames = ["ENCRYPTED_CREDENTIALS", "CREDENTIALS_IV", "CREDENTIAL_KEY", "CAITLYN_API_KEY"];

export function createLocalFxService(app, credentials, cacheProbe) {
	let initialization;
	return {
		fetch: async (request, env, context) => {
			const reply = (status, body) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
			const configured = secretNames.some((name) => Boolean(env[name]));
			if (configured && !secretNames.every((name) => typeof env[name] === "string" && env[name].length > 0)) return reply(503, { reason: "account_configuration_invalid" });
			if (configured) {
				const key = request.headers.get("x-caitlyn-key") ?? "";
				let difference = 0;
				if (!/^[a-f0-9]{64}$/.test(env.CAITLYN_API_KEY) || key.length !== 64) return reply(401, { reason: "local_auth_required" });
				for (let index = 0; index < 64; index++) difference |= key.charCodeAt(index) ^ env.CAITLYN_API_KEY.charCodeAt(index);
				if (difference !== 0) return reply(401, { reason: "local_auth_required" });
			}
			if (request.method !== "GET") return reply(405, { reason: "method_not_allowed" });
			const url = new URL(request.url);
			const health = url.pathname === "/__caitlyn/health";
			if ((!health && !/^\/2\/status\/[1-9]\d{1,19}$/.test(url.pathname)) || url.search) return reply(404, { reason: "route_not_found" });
			try {
				if (configured) {
					// The bundle reads these runtime values only through upstream's credential functions.
					globalThis.CAITLYN_FX_ENCRYPTED_CREDENTIALS = env.ENCRYPTED_CREDENTIALS;
					globalThis.CAITLYN_FX_CREDENTIALS_IV = env.CREDENTIALS_IV;
					initialization ??= credentials.initCredentials(env.CREDENTIAL_KEY);
					await initialization;
					if (!credentials.hasDecryptedCredentials()) return reply(503, { reason: "account_initialization_failed" });
				}
				if (health) {
					await cacheProbe();
					return reply(200, { service: "fxembed", ready: true, accountConfigured: configured });
				}
				// Do not forward the local key, caller cookies, Origin or arbitrary headers upstream.
				url.hostname = "caitlyn-fxembed.invalid";
				url.port = "";
				const clean = new Request(url, { headers: { Accept: "application/json", "User-Agent": "Caitlyn/3.0 local FxEmbed integration" } });
				const upstream = await app.fetch(clean, { CREDENTIAL_KEY: configured ? env.CREDENTIAL_KEY : undefined }, context);
				const response = new Response(upstream.body, upstream);
				response.headers.set("Cache-Control", "no-store");
				response.headers.delete("Access-Control-Allow-Origin");
				return response;
			}
			catch { return reply(503, { reason: "local_backend_unavailable" }); }
		},
	};
}
