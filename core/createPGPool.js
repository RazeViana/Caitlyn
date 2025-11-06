/**
 * @file createPGPool.js
 * @description This module provides functionality to create and manage a PostgreSQL connection pool
 * using the `pg` library.
 *
 * The pool instance is exported for use in other parts of the application.
 *
 * @module createPGPool
 */

import pg from "pg";
import logger from "./logger.js";

const { Pool } = pg;

// Create a new PostgreSQL connection pool
const pool = new Pool();

async function createPGPool() {
	try {
		// Check if the connection is successful by executing a simple query
		const res = await pool.query("SELECT NOW()");
		if (res.rows.length) {
			logger.success("Connected to PostgreSQL Caitlyn~DB");
		}
	} catch (err) {
		// If the connection fails, log the error and exit the process
		logger.error("PostgreSQL connection failed:", err);
	}
}

// Export the pool instance for use in other modules
export { createPGPool, pool };
