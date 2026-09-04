/**
 * @file createPGPool.ts
 * @description This module provides functionality to create and manage a PostgreSQL connection pool
 * using the `pg` library.
 *
 * The pool instance is exported for use in other parts of the application.
 *
 * @module createPGPool
 */

import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool();

async function createPGPool(): Promise<void> {
	try {
		const res = await pool.query("SELECT NOW()");
		if (res.rows.length) {
			console.log("[INFO] Connected to PostgreSQL Caitlyn~DB");
		}
	}
	catch (err) {
		console.error(
			"[Error] PostgreSQL connection failed: \n",
			err instanceof Error ? err.stack : err,
		);
	}
}

export { createPGPool, pool };
