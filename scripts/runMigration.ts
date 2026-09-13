/**
 * @file runMigration.ts
 * @description Runs a selected SQL migration from the repository's migrations directory.
 * Uses the configured PostgreSQL connection without tracking migration history.
 *
 * @module runMigration
 */

import "../core/loadEnvironment.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;

interface MigrationPool {
	end: () => Promise<void>;
	query: (sql: string) => Promise<unknown>;
}

export interface RunMigrationDependencies {
	log: (message: string) => void;
	pool: MigrationPool;
}

const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const defaultDependencies: RunMigrationDependencies = {
	log: console.log,
	pool: new Pool(),
};

async function runMigration(
	migrationFile = process.argv[2] || "001_create_messages_table.sql",
	dependencies: RunMigrationDependencies = defaultDependencies,
): Promise<void> {
	try {
		const fullPath = path.join(migrationsDirectory, migrationFile);

		if (!fs.existsSync(fullPath)) {
			console.error(`✗ Migration file not found: ${migrationFile}`);
			process.exit(1);
		}

		const sql = fs.readFileSync(fullPath, "utf8");

		dependencies.log(`Running migration: ${migrationFile}`);
		await dependencies.pool.query(sql);
		dependencies.log("✓ Migration completed successfully");

		await dependencies.pool.end();
	}
	catch (error: unknown) {
		console.error("✗ Migration failed:", error);
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void runMigration();
}

export { runMigration };
