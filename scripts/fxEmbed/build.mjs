/**
 * @file build.mjs
 * @description Bundles pinned, unmodified FxEmbed source for Caitlyn's local-only API.
 * Disables hosted helpers and telemetry; optional encrypted credentials arrive only at runtime.
 *
 * @module fxEmbedBuild
 */

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { rootCertificates } from "node:tls";

const empty = [
	"STANDARD_BSKY_DOMAIN_LIST", "STANDARD_TIKTOK_DOMAIN_LIST", "STANDARD_INSTAGRAM_DOMAIN_LIST",
	"DIRECT_MEDIA_DOMAINS", "TEXT_ONLY_DOMAINS", "INSTANT_VIEW_DOMAINS", "GALLERY_DOMAINS", "FORCE_MOSAIC_DOMAINS",
	"MOSAIC_DOMAIN_LIST", "MOSAIC_BSKY_DOMAIN_LIST", "POLYGLOT_DOMAIN_LIST", "POLYGLOT_ACCESS_TOKEN",
	"BLUESKY_API_HOST_LIST", "ATMOSPHERE_API_HOST_LIST", "SENTRY_DSN", "GIF_TRANSCODE_DOMAIN_LIST",
	"VIDEO_TRANSCODE_DOMAIN_LIST", "VIDEO_TRANSCODE_BSKY_DOMAIN_LIST", "PBS_PROXY_DOMAIN_LIST", "OLD_EMBED_DOMAINS",
	"INSTAGRAM_ROOT", "INSTAGRAM_API_ROOT",
];
const values = Object.fromEntries(empty.map((name) => [name, ""]));
Object.assign(values, {
	STANDARD_DOMAIN_LIST: "caitlyn-fxembed.invalid", API_HOST_LIST: "caitlyn-fxembed.invalid",
	TWITTER_ROOT: "https://x.com", RELEASE_NAME: "caitlyn-fxembed-5b5b6207d9fd",
});
copyFileSync("branding.example.json", "branding.json");
// Supply Node's standard Mozilla root store to workerd/OpenSSL; TLS verification stays enabled.
writeFileSync("ca-certificates.pem", rootCertificates.join("\n") + "\n");
await build({
	entryPoints: ["entry.mjs"], outfile: "dist/worker.js", minify: true, bundle: true, format: "esm",
	plugins: [{ name: "local-cache-compatibility", setup(builder) {
		builder.onLoad({ filter: /providers\/twitter\/fetch\.js$/ }, (args) => {
			const upstream = readFileSync(args.path, "utf8");
			const hint = /cacheTtl: env\.guestTokenMaxAge/g;
			if ([...upstream.matchAll(hint)].length !== 2) throw new Error("fxembed_cache_compatibility_needs_review");
			// Local workerd rejects cloned requests carrying this Cloudflare edge-cache hint.
			// The explicit guest-token Cache API and its max-age header remain upstream-owned.
			return { contents: upstream.replace(hint, "cacheControl: 'no-store'"), loader: "js" };
		});
	} }],
	define: { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])),
		"process.env.ENCRYPTED_CREDENTIALS": "globalThis.CAITLYN_FX_ENCRYPTED_CREDENTIALS",
		"process.env.CREDENTIALS_IV": "globalThis.CAITLYN_FX_CREDENTIALS_IV" },
});
