/**
 * @file applyDatabaseRelease.mjs
 * @description Applies the tested missing migrations to an explicitly selected original database over trusted SSH.
 * Locks and verifies original rows before and after the transaction using timezone-normalized backup fingerprints.
 *
 * @module applyDatabaseRelease
 */

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const migrations = ["010_unique_birthday_discord_id.sql", "011_create_guild_settings.sql", "012_private_logging_levels.sql", "013_birthday_delivery_tracking.sql", "014_social_delivery.sql", "015_quarantine_ambiguous_voice_sessions.sql", "016_social_source_replacement.sql"];
const tables = ["birthdays", "daily_activity", "messages", "user_activity", "voice_sessions"];

export function preservationAssertion(report) {
	if (report?.restored !== true || report.originalRecordsPreserved !== true || report.timezone !== "UTC"
		|| JSON.stringify(report.migrations) !== JSON.stringify(migrations) || !report.before) throw new Error("verified_utc_backup_required");
	const checks = tables.map((table) => {
		const value = report.before[table];
		if (!Number.isSafeInteger(value?.count) || value.count < 0 || (value.fingerprint !== null && !/^[a-f0-9]{32}$/.test(value.fingerprint))) throw new Error("invalid_backup_fingerprint");
		const expression = table === "voice_sessions" ? "to_jsonb(t) - 'needs_reconciliation'" : "to_jsonb(t)";
		const expected = value.fingerprint === null ? "NULL" : "'" + value.fingerprint + "'";
		return `IF (SELECT count(*) FROM discord.${table}) <> ${value.count} OR (SELECT md5(string_agg(md5((${expression})::text), ',' ORDER BY id)) FROM discord.${table} t) IS DISTINCT FROM ${expected} THEN RAISE EXCEPTION 'Original records changed: ${table}'; END IF;`;
	});
	return "DO $verify$ BEGIN\n" + checks.join("\n") + "\nEND $verify$;";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const [reportFile, alias, host, keyAlias, container, port, database] = process.argv.slice(2);
		if (process.argv.length !== 9 || !isAbsolute(reportFile ?? "")
			|| ![alias, container, database].every((value) => /^[a-zA-Z0-9_-]+$/.test(value ?? ""))
			|| ![host, keyAlias].every((value) => /^[a-zA-Z0-9.:-]+$/.test(value ?? "")) || !/^\d{1,5}$/.test(port ?? "") || +port < 1 || +port > 65535) throw new Error("explicit_database_target_required");
		const report = JSON.parse(await readFile(reportFile, "utf8"));
		const assertion = preservationAssertion(report);
		const directory = fileURLToPath(new URL("../../migrations/", import.meta.url));
		const migrationSql = (await Promise.all(migrations.map((name) => readFile(directory + name, "utf8")))).join("\n");
		const sql = "BEGIN; SET LOCAL TIME ZONE 'UTC'; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s';\n"
			+ "LOCK TABLE " + tables.map((table) => "discord." + table).join(",") + " IN SHARE ROW EXCLUSIVE MODE;\n"
			+ assertion + "\n" + migrationSql + "\n" + assertion + "\nCOMMIT;\n";
		const output = execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=" + keyAlias,
			"-o", "HostName=" + host, alias, `sudo -n docker exec -i -u postgres ${container} psql -X -v ON_ERROR_STOP=1 -p ${port} -d ${database}`], {
			input: sql, maxBuffer: 1_048_576, timeout: 60_000, stdio: ["pipe", "pipe", "pipe"],
		}).toString();
		if (!output.trim().endsWith("COMMIT")) throw new Error("commit_not_confirmed");
		await writeFile(dirname(reportFile) + "/migration-result.txt", output, { flag: "wx", mode: 0o600 });
		console.log("Original database migrations 010–016 committed; all original row counts and UTC-normalized fingerprints match the verified backup");
	}
	catch {
		console.error("Database migration was not confirmed; inspect the target before retrying. No credentials or row contents were logged");
		process.exitCode = 1;
	}
}
