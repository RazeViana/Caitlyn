const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPGPool, pool } = require("../core/createPGPool.ts");

test("PostgreSQL initialization checks the connection with SELECT NOW", async () => {
	const originalQuery = pool.query;
	const originalLog = console.log;
	const queries = [];
	const logs = [];

	pool.query = async (...args) => {
		queries.push(args);
		return { rows: [{ now: new Date("2026-09-04T12:00:00Z") }] };
	};
	console.log = (...args) => logs.push(args);

	try {
		await createPGPool();

		assert.deepEqual(queries, [["SELECT NOW()"]]);
		assert.deepEqual(logs, [
			["[INFO] Connected to PostgreSQL Caitlyn~DB"],
		]);
	}
	finally {
		pool.query = originalQuery;
		console.log = originalLog;
	}
});
