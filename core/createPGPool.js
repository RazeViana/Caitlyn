/**
 * @file createPGPool.js
 * @description This module provides functionality to create and manage a PostgreSQL connection pool
 * using the `pg` library.
 *
 * The pool instance is exported for use in other parts of the application.
 *
 * @module createPGPool
 */

const { Pool } = require("pg");
require("dotenv").config();

// Create a new PostgreSQL connection pool
const pool = new Pool();

async function createPGPool() {
	try {
		// Check if the connection is successful by executing a simple query
		const res = await pool.query("SELECT NOW()");
		if (res.rows.length) {
			console.log("✅ Connected to PostgreSQL @", res.rows[0].now);
		}
	} catch (err) {
		// If the connection fails, log the error and exit the process
		console.error("❌ PostgreSQL connection failed:", err.stack);
		process.exit(1);
	}
}

// Export the pool instance for use in other modules
module.exports = {
	createPGPool,
	pool,
};
