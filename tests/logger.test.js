import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const loggerUrl = pathToFileURL(path.resolve("core/logger.ts")).href;

async function runLogger(level) {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "caitlyn-logger-"));
	const script = `
		const output = { error: [], log: [], warn: [] };
		console.error = (...args) => output.error.push(args);
		console.log = (...args) => output.log.push(args);
		console.warn = (...args) => output.warn.push(args);
		const NativeDate = Date;
		globalThis.Date = class extends NativeDate {
			constructor(...args) {
				super(...(args.length === 0 ? ["2026-09-04T12:34:56.000Z"] : args));
			}
			static now() { return new NativeDate("2026-09-04T12:34:56.000Z").getTime(); }
		};
		const { default: logger } = await import(${JSON.stringify(loggerUrl)});
		logger.debug("debug", 1);
		logger.info("info", 2);
		logger.success("success", 3);
		logger.warn("warn", 4);
		logger.error("error", 5);
		process.stdout.write(JSON.stringify(output));
	`;
	const childEnvironment = { LOG_LEVEL: level };
	for (const name of ["SystemRoot", "WINDIR"]) {
		if (process.env[name] !== undefined) childEnvironment[name] = process.env[name];
	}

	try {
		const child = spawnSync(process.execPath, [
			"--import",
			import.meta.resolve("tsx"),
			"--input-type=module",
			"--eval",
			script,
		], {
			cwd: temporaryDirectory,
			encoding: "utf8",
			env: childEnvironment,
		});
		assert.equal(child.status, 0, child.stderr);
		return JSON.parse(child.stdout);
	}
	finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}

test("DEBUG logger level emits every level with the exact timestamp, tag, color, and joined arguments", async () => {
	const output = await runLogger("DEBUG");

	assert.deepEqual(output, {
		error: [["\u001b[90m2026-09-04 12:34:56\u001b[0m \u001b[31m\u001b[1m[ERROR]\u001b[0m error 5"]],
		log: [
			["\u001b[90m2026-09-04 12:34:56\u001b[0m \u001b[35m\u001b[1m[DEBUG]\u001b[0m debug 1"],
			["\u001b[90m2026-09-04 12:34:56\u001b[0m \u001b[36m\u001b[1m[INFO]\u001b[0m info 2"],
			["\u001b[90m2026-09-04 12:34:56\u001b[0m \u001b[32m\u001b[1m[SUCCESS]\u001b[0m success 3"],
		],
		warn: [["\u001b[90m2026-09-04 12:34:56\u001b[0m \u001b[33m\u001b[1m[WARN]\u001b[0m warn 4"]],
	});
});

test("WARN logger level filters lower-severity output while preserving warning and error formatting", async () => {
	const output = await runLogger("WARN");

	assert.deepEqual(output, {
		error: [["\u001b[90m2026-09-04 12:34:56\u001b[0m \u001b[31m\u001b[1m[ERROR]\u001b[0m error 5"]],
		log: [],
		warn: [["\u001b[90m2026-09-04 12:34:56\u001b[0m \u001b[33m\u001b[1m[WARN]\u001b[0m warn 4"]],
	});
});
