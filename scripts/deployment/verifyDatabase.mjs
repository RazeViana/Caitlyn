/**
 * @file verifyDatabase.mjs
 * @description Restores a private production backup into a uniquely named local verification database.
 * Checks missing release migrations preserve all original records, then removes only that temporary database.
 *
 * @module verifyDeploymentDatabase
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

const dump = process.argv[2];
if (!isAbsolute(dump ?? "") || process.argv.length !== 3) throw new Error("require_private_backup_path");
const user = process.env.USER;
if (!user) throw new Error("local_database_user_missing");
const configuration = { host: "127.0.0.1", port: 5432, user, password: "", database: "postgres", options: "-c timezone=UTC" };
const admin = new pg.Pool(configuration);
const database = "caitlyn_deploy_verify_" + randomBytes(6).toString("hex");
const pool = new pg.Pool({ ...configuration, database });
let created = false;
const fingerprints = async () => {
	const result = {};
	for (const table of ["birthdays", "daily_activity", "messages", "user_activity", "voice_sessions"]) {
		const expression = table === "voice_sessions" ? "to_jsonb(t) - 'needs_reconciliation'" : "to_jsonb(t)";
		result[table] = (await pool.query(`SELECT count(*)::integer AS count, md5(string_agg(md5((${expression})::text), ',' ORDER BY id)) AS fingerprint FROM discord.${table} t`)).rows[0];
	}
	return result;
};
try {
	await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
	created = true;
	try {
		await promisify(execFile)("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", "-h", "127.0.0.1", "-p", "5432", "-U", user, "-d", database, dump], {
			timeout: 120_000, maxBuffer: 1_048_576, env: { ...process.env, PGPASSWORD: "", PGOPTIONS: "" },
		});
	}
	catch { throw new Error("private_backup_restore_failed"); }
	const before = await fingerprints();
	const directory = fileURLToPath(new URL("../../migrations/", import.meta.url));
	const migrations = ["010_unique_birthday_discord_id.sql", "011_create_guild_settings.sql", "012_private_logging_levels.sql", "013_birthday_delivery_tracking.sql", "014_social_delivery.sql", "015_quarantine_ambiguous_voice_sessions.sql", "016_social_source_replacement.sql"];
	const sql = (await Promise.all(migrations.map((name) => readFile(directory + name, "utf8")))).join("\n");
	await pool.query("BEGIN; SET LOCAL statement_timeout = '30s'; SET LOCAL lock_timeout = '5s';\n" + sql + "\nCOMMIT;");
	const after = await fingerprints();
	if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("migration_changed_original_records");
	const report = { databaseSource: "original mainframe backup", timezone: "UTC", restored: true, migrations, originalRecordsPreserved: true, before, after };
	await writeFile(dirname(dump) + "/restore-verification-utc.json", JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
	console.log(JSON.stringify({ restored: true, originalRecordsPreserved: true, counts: Object.fromEntries(Object.entries(after).map(([table, value]) => [table, value.count])), temporaryDatabase: database }));
}
catch {
	console.error("Database release verification failed; no application database was changed");
	process.exitCode = 1;
}
finally {
	await pool.end();
	if (created) {
		await admin.query(`DROP DATABASE "${database}"`);
		console.log("Removed the temporary local restore-verification database; both application databases are unchanged");
	}
	await admin.end();
}
