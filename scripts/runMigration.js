import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool();

async function runMigration() {
	try {
		const migrationFile = process.argv[2] || "001_create_messages_table.sql";
		const fullPath = path.join(__dirname, "../migrations", migrationFile);

		if (!fs.existsSync(fullPath)) {
			console.error(`✗ Migration file not found: ${migrationFile}`);
			process.exit(1);
		}

		const sql = fs.readFileSync(fullPath, "utf8");

		console.log(`Running migration: ${migrationFile}`);
		await pool.query(sql);
		console.log("✓ Migration completed successfully");

		await pool.end();
	} catch (error) {
		console.error("✗ Migration failed:", error);
		process.exit(1);
	}
}

runMigration();
