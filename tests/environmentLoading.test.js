/**
 * @file environmentLoading.test.js
 * @description Verifies direct core imports load configuration from a local environment file.
 * Runs in an isolated temporary directory with synthetic settings.
 *
 * @module environmentLoading.test
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("core configuration loads from .env on direct import", async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-env-"));
	try {
		await writeFile(path.join(temporaryDirectory, ".env"), "LLM_ENABLED=true\nOLLAMA_MODEL=fixture\nWEBUI_API_KEY=fixture\nWEBUI_CHAT_ENDPOINT=https://fixture.invalid/chat\n", "utf8");
		const moduleUrl = pathToFileURL(path.resolve("core/aiState.ts")).href;
		const tsxUrl = import.meta.resolve("tsx");
		const script = `
			const { isAIEnabled } = await import(${JSON.stringify(moduleUrl)});
			process.stdout.write(String(isAIEnabled()));
		`;
		const environment = { ...process.env };
		delete environment.LLM_ENABLED;
		const result = spawnSync(process.execPath, [
			"--import",
			tsxUrl,
			"--input-type=module",
			"--eval",
			script,
		], {
			cwd: temporaryDirectory,
			encoding: "utf8",
			env: environment,
		});

		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, "true");
	}
	finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
});

test("bot configuration preserves overrides and excludes file and inherited FxEmbed session fields", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-env-isolation-"));
	try {
		await writeFile(path.join(directory, ".env"), "LLM_ENABLED=false\nLOG_LEVEL=ERROR\nFXEMBED_X_USERNAME=fixture\nFXEMBED_X_AUTH_TOKEN=file-secret\nFXEMBED_X_CT0=file-csrf\n");
		const moduleUrl = pathToFileURL(path.resolve("core/loadEnvironment.ts")).href;
		const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", `
			await import(${JSON.stringify(moduleUrl)});
			console.log(JSON.stringify({ ai: process.env.LLM_ENABLED, level: process.env.LOG_LEVEL,
				accountKeys: Object.keys(process.env).filter(name => name.startsWith("FXEMBED_X_")) }));
		`], { cwd: directory, encoding: "utf8", env: { PATH: process.env.PATH, LLM_ENABLED: "true", FXEMBED_X_AUTH_TOKEN: "inherited-secret", FXEMBED_X_FUTURE: "another-secret" } });
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout), { ai: "true", level: "ERROR", accountKeys: [] });
		assert.equal(result.stderr, "");
	}
	finally { await rm(directory, { recursive: true, force: true }); }
});

test("a configured .env path retains normal configuration behavior without loading X secrets", async () => {
	const directory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-env-path-"));
	try {
		const file = path.join(directory, "configured.env");
		await writeFile(file, "LOG_LEVEL=WARN\nFXEMBED_X_CT0=private\n");
		const moduleUrl = pathToFileURL(path.resolve("core/loadEnvironment.ts")).href;
		const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", `
			await import(${JSON.stringify(moduleUrl)});
			console.log(JSON.stringify({ level: process.env.LOG_LEVEL, hasCookie: process.env.FXEMBED_X_CT0 !== undefined }));
		`], { cwd: directory, encoding: "utf8", env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: file } });
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout), { level: "WARN", hasCookie: false });
	}
	finally { await rm(directory, { recursive: true, force: true }); }
});

test("Git and the bot Docker context exclude the local .env file", async () => {
	for (const file of [".gitignore", ".dockerignore"]) assert.match(await readFile(file, "utf8"), /^\.env$/m);
});
