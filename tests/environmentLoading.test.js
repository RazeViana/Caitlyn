import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("core configuration loads from .env on direct import", async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-env-"));
	try {
		await writeFile(path.join(temporaryDirectory, ".env"), "LLM_ENABLED=true\n", "utf8");
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
