import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

test("migration runner resolves migrations from the repository directory", async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-migration-"));

	try {
		const migrationUrl = new URL("../migrations/001_create_messages_table.sql", import.meta.url);
		const expectedSql = await readFile(migrationUrl, "utf8");
		const moduleUrl = pathToFileURL(path.resolve("scripts/runMigration.ts")).href;
		const tsxUrl = import.meta.resolve("tsx");
		const script = `
			const { runMigration } = await import(${JSON.stringify(moduleUrl)});
			let receivedSql;
			let ended = false;
			await runMigration("001_create_messages_table.sql", {
				log: () => undefined,
				pool: {
					end: async () => { ended = true; },
					query: async (sql) => { receivedSql = sql; },
				},
			});
			process.stdout.write(JSON.stringify({ ended, receivedSql }));
		`;
		const result = spawnSync(process.execPath, [
			"--import",
			tsxUrl,
			"--input-type=module",
			"--eval",
			script,
		], {
			cwd: temporaryDirectory,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		const output = JSON.parse(result.stdout);
		assert.equal(output.receivedSql, expectedSql);
		assert.equal(output.ended, true);
	}
	finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
});

test("diagnostic scripts import typed core services without executing on import", () => {
	const scriptUrls = [
		"checkMessages.ts",
		"runMigration.ts",
		"testContext.ts",
		"testMemory.ts",
	].map((scriptName) => pathToFileURL(path.resolve("scripts", scriptName)).href);
	const tsxUrl = import.meta.resolve("tsx");
	const script = `await Promise.all(${JSON.stringify(scriptUrls)}.map((url) => import(url)));`;
	const result = spawnSync(process.execPath, [
		"--import",
		tsxUrl,
		"--input-type=module",
		"--eval",
		script,
	], {
		encoding: "utf8",
	});

	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "");
	assert.equal(result.stderr, "");
});

test("memory diagnostic without a channel exits with runnable TypeScript self-help before touching services", async () => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-memory-help-"));
	const scriptPath = path.resolve("scripts/testMemory.ts");
	const childEnvironment = {};
	for (const name of ["SystemRoot", "WINDIR"]) {
		if (process.env[name] !== undefined) childEnvironment[name] = process.env[name];
	}

	try {
		const result = spawnSync(process.execPath, [
			"--import",
			import.meta.resolve("tsx"),
			scriptPath,
		], {
			cwd: temporaryDirectory,
			encoding: "utf8",
			env: childEnvironment,
		});

		assert.equal(result.status, 1);
		assert.equal(result.signal, null);
		assert.equal(
			result.stdout,
			"Usage: npx tsx scripts/testMemory.ts <channel_id>\n\n"
			+ "This will clear all messages from the specified channel.\n",
		);
		assert.equal(result.stderr, "");
	}
	finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
});
