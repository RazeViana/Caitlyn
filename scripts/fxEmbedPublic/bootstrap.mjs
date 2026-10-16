/**
 * @file bootstrap.mjs
 * @description Starts a local-only Workers runtime for the public preview frontend.
 * Contains no account credentials, cloud deployment, or interactive configuration.
 *
 * @module publicFxBootstrap
 */

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const directory = "/tmp/caitlyn-public-fxembed";
await mkdir(directory, { mode: 0o700, recursive: true });
await writeFile(directory + "/wrangler.json", JSON.stringify({ name: "caitlyn-public-fxembed", main: "/app/dist/public-worker.js",
	compatibility_date: "2026-04-11", send_metrics: false }), { mode: 0o600 });
const child = spawn(process.execPath, ["/app/node_modules/wrangler/bin/wrangler.js", "dev", "--config", directory + "/wrangler.json",
	"--local", "--ip", "0.0.0.0", "--port", "8787", "--inspector-ip", "127.0.0.1", "--inspector-port", "0",
	"--persist-to", directory + "/state", "--log-level", "none"], {
	cwd: directory, stdio: "ignore", env: { ...process.env, WRANGLER_LOG_PATH: "/dev/null", WRANGLER_SEND_METRICS: "false", XDG_CONFIG_HOME: directory + "/config", CI: "true" },
});
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill(signal));
child.once("error", () => {
	console.error("Public FxEmbed runtime failed to start");
	process.exitCode = 1;
});
child.once("exit", (code) => {
	console.info("Public FxEmbed runtime stopped", code);
	process.exitCode = code ?? 1;
});
