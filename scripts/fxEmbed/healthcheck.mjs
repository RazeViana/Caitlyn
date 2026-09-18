/**
 * @file healthcheck.mjs
 * @description Checks local FxEmbed readiness using its mounted private API key without logging secrets.
 * Does not request any X post or treat configured credentials as proof of an accepted X session.
 *
 * @module fxEmbedHealthcheck
 */

import { readRuntimeSecrets } from "./bootstrap.mjs";

try {
	const config = await readRuntimeSecrets(process.env.CAITLYN_FX_CONFIG_FILE);
	const response = await fetch("http://127.0.0.1:8787/__caitlyn/health", {
		redirect: "error", signal: AbortSignal.timeout(3_000),
		headers: config.CAITLYN_API_KEY ? { "x-caitlyn-key": config.CAITLYN_API_KEY } : {},
	});
	const health = await response.json();
	if (!response.ok || health.service !== "fxembed" || health.ready !== true || health.accountConfigured !== Boolean(config.CAITLYN_API_KEY)) throw new Error("not_ready");
}
catch { process.exitCode = 1; }
