/**
 * @file bootstrap.mjs
 * @description Receives encrypted account configuration over Docker stdin and starts a quiet local runtime.
 * Configuration and Wrangler state live only in the container's private, temporary memory filesystem.
 *
 * @module fxEmbedBootstrap
 */

import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const directory = "/tmp/caitlyn-fxembed";
const names = ["ENCRYPTED_CREDENTIALS", "CREDENTIALS_IV", "CREDENTIAL_KEY", "CAITLYN_API_KEY"];

export function validateRuntimeSecrets(input) {
	if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_runtime_configuration");
	const keys = Object.keys(input);
	if (keys.length === 0) return {};
	if (keys.length !== names.length || !names.every((name) => typeof input[name] === "string")) throw new Error("invalid_runtime_configuration");
	if (!/^[A-Za-z0-9+/]{64,8192}={0,2}$/.test(input.ENCRYPTED_CREDENTIALS) || !/^[A-Za-z0-9+/]{16}$/.test(input.CREDENTIALS_IV)
		|| !/^[A-Za-z0-9_-]{43}$/.test(input.CREDENTIAL_KEY) || !/^[a-f0-9]{64}$/.test(input.CAITLYN_API_KEY)) throw new Error("invalid_runtime_configuration");
	return Object.fromEntries(names.map((name) => [name, input[name]]));
}

async function privateDirectory() {
	await mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
	const info = await lstat(directory);
	if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw new Error("invalid_runtime_directory");
}

async function configure() {
	const timeout = setTimeout(() => { process.exit(1); }, 5000);
	try {
		const chunks = [];
		let size = 0;
		for await (const chunk of process.stdin) {
			size += chunk.length;
			if (size > 16_384) throw new Error("runtime_configuration_too_large");
			chunks.push(chunk);
		}
		const config = validateRuntimeSecrets(JSON.parse(Buffer.concat(chunks).toString("utf8")));
		await privateDirectory();
		await writeFile(directory + "/input.tmp", JSON.stringify(config), { mode: 0o600, flag: "wx" });
		await rename(directory + "/input.tmp", directory + "/input.json");
	}
	finally { clearTimeout(timeout); }
}

async function start() {
	process.umask(0o077);
	await privateDirectory();
	let config;
	for (let attempt = 0; attempt < 200; attempt++) {
		try {
			config = validateRuntimeSecrets(JSON.parse(await readFile(directory + "/input.json", "utf8")));
			break;
		}
		catch (error) { if (error.code !== "ENOENT") throw error; }
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	if (!config) throw new Error("runtime_configuration_missing");
	await writeFile(directory + "/wrangler.json", JSON.stringify({ name: "caitlyn-fxembed", main: "/app/dist/worker.js", compatibility_date: "2026-04-11",
		send_metrics: false, vars: config }), { mode: 0o600, flag: "wx" });
	await unlink(directory + "/input.json");
	const child = spawn(process.execPath, ["/app/node_modules/wrangler/bin/wrangler.js", "dev", "--config", directory + "/wrangler.json",
		"--local", "--ip", "0.0.0.0", "--port", "8787", "--inspector-ip", "127.0.0.1", "--inspector-port", "0", "--persist-to", directory + "/state", "--log-level", "none"], {
		cwd: directory, stdio: "ignore", env: { ...process.env, WRANGLER_LOG_PATH: "/dev/null", WRANGLER_SEND_METRICS: "false", XDG_CONFIG_HOME: directory + "/config", CI: "true" },
	});
	for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { child.kill(signal); });
	child.once("error", () => { process.exitCode = 1; });
	child.once("exit", (code) => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		if (process.argv[2] === "--configure" && process.argv.length === 3) await configure();
		else if (process.argv.length === 2) await start();
		else throw new Error("invalid_bootstrap_options");
	}
	catch {
		console.error("Local FxEmbed bootstrap failed; no configuration values logged");
		process.exitCode = 1;
	}
}
