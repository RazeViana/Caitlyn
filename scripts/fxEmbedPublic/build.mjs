/**
 * @file build.mjs
 * @description Builds public previews from the same pinned FxEmbed source and dependencies as Caitlyn.
 * Applies asserted compatibility changes for local workerd and one-domain platform routing.
 *
 * @module publicFxBuild
 */

import { readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const origin = new URL(process.env.FXEMBED_PUBLIC_ORIGIN);
if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.port || origin.username || origin.password) throw new Error("invalid_public_origin");
const keys = [...readFileSync("src/constants.ts", "utf8").matchAll(/process\.env\.([A-Z_]+)/g)].map((match) => match[1]);
const values = Object.fromEntries(keys.map((key) => [key, ""]));
Object.assign(values, { STANDARD_DOMAIN_LIST: origin.hostname, STANDARD_TIKTOK_DOMAIN_LIST: origin.hostname,
	STANDARD_INSTAGRAM_DOMAIN_LIST: origin.hostname, TWITTER_ROOT: "https://x.com", INSTAGRAM_ROOT: "https://www.instagram.com",
	INSTAGRAM_API_ROOT: "https://i.instagram.com", RELEASE_NAME: "caitlyn-public-fxembed-5b5b6207d9fd", FXEMBED_PUBLIC_ORIGIN: origin.origin });
writeFileSync("branding.json", JSON.stringify({ zones: [{ name: "Caitlyn · FxEmbed", default: true, domains: [origin.hostname], provider: "twitter",
	favicon: "https://abs.twimg.com/favicons/twitter.3.ico", redirect: origin.origin, color: "#5865F2" }] }));

function replaceExact(source, before, after, count = 1) {
	if (source.split(before).length !== count + 1) throw new Error("public_fxembed_transform_needs_review");
	return source.replaceAll(before, after);
}

await build({ entryPoints: ["public-entry.mjs"], outfile: "dist/public-worker.js", minify: true, bundle: true, format: "esm",
	plugins: [{ name: "public-local-compatibility", setup(builder) {
		builder.onLoad({ filter: /(?:src\/worker\.ts|src\/embed\/(?:status|activity)\.ts|providers\/twitter\/fetch\.js)$/ }, (args) => {
			let source = readFileSync(args.path, "utf8");
			if (args.path.endsWith("/src/worker.ts")) {
				source = replaceExact(source, "    if (realm) {", "    realm = req.headers.get('x-caitlyn-platform') ?? realm;\n    if (realm) {");
			}
			else if (args.path.endsWith("/src/embed/status.ts")) {
				source = replaceExact(source, "      i: statusId", "      i: statusId, f: status.provider");
				source = replaceExact(source, "!!Constants.API_HOST_LIST", "Boolean(Constants.API_HOST_LIST[0])");
			}
			else if (args.path.endsWith("/src/embed/activity.ts")) {
				// An unset API host becomes [""], which is truthy. Without this check,
				// ordinary and article videos point to https:///2/go instead of the CDN.
				source = replaceExact(source, "!!Constants.API_HOST_LIST", "Boolean(Constants.API_HOST_LIST[0])", 2);
			}
			else {
				source = replaceExact(source, "cacheTtl: env.guestTokenMaxAge", "cacheControl: 'no-store'", 2);
			}
			return { contents: source, loader: args.path.endsWith(".ts") ? "ts" : "js" };
		});
	} }],
	define: { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])),
		"process.env.ENCRYPTED_CREDENTIALS": "undefined", "process.env.CREDENTIALS_IV": "undefined", "process.env.SENTRY_DSN": "undefined" },
});
