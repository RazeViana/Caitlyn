/**
 * @file transcriptionWorker.test.js
 * @description Runs standard-library HTTP worker tests as part of the normal quality gate.
 * @module transcriptionWorker.test
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("local speech worker validates audio and uses only its injected model", () => {
	const result = spawnSync("python3", ["tests/transcriptionWorker.test.py"], { encoding: "utf8", timeout: 15_000 });
	assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stderr}`);
});
