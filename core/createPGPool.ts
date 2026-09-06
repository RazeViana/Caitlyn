/**
 * @file createPGPool.ts
 * @description Configures the shared PostgreSQL pool with connection and query deadlines.
 * Logs idle-pool errors and retries transient startup probes before propagating failure.
 *
 * @module createPGPool
 */

import "dotenv/config";

import pg from "pg";
import logger from "./logger.js";
import { setTimeout as delay } from "node:timers/promises";

const { Pool } = pg;

// Create a new PostgreSQL connection pool
const pool = new Pool({
	connectionTimeoutMillis: 5_000,
	statement_timeout: 10_000,
	query_timeout: 15_000,
	idle_in_transaction_session_timeout: 15_000,
});
pool.on("error", (error) => {
	logger.error("PostgreSQL background connection error; failed connection removed:", error);
});

async function createPGPool(wait: (milliseconds: number) => Promise<unknown> = delay): Promise<void> {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await pool.query("SELECT NOW()");
			logger.success("Connected to PostgreSQL");
			return;
		}
		catch (error) {
			const code = (error as { code?: string }).code ?? "";
			const transient = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P03"].includes(code)
				|| code.startsWith("08");
			if (!transient || attempt === 3) throw error;
			logger.warn(`PostgreSQL unavailable; retrying startup (${attempt}/3)`);
			await wait(attempt * 1_000);
		}
	}
}

// Export the pool instance for use in other modules
export { createPGPool, pool };
