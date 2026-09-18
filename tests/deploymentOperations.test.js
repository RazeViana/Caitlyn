/**
 * @file deploymentOperations.test.js
 * @description Checks that original-database preservation checks require verified UTC-normalized backups.
 * Uses synthetic fingerprints only and never runs migrations or SSH.
 *
 * @module deploymentOperations.test
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { preservationAssertion } from "../scripts/deployment/applyDatabaseRelease.mjs";

function fixture() {
	return { restored: true, originalRecordsPreserved: true, timezone: "UTC",
		migrations: ["010_unique_birthday_discord_id.sql", "011_create_guild_settings.sql", "012_private_logging_levels.sql", "013_birthday_delivery_tracking.sql", "014_social_delivery.sql", "015_quarantine_ambiguous_voice_sessions.sql", "016_social_source_replacement.sql"],
		before: Object.fromEntries(["birthdays", "daily_activity", "messages", "user_activity", "voice_sessions"].map((table) => [table, { count: 3, fingerprint: "a".repeat(32) }])) };
}

test("original-database migration assertions refuse an unverified backup or mismatched timezone", () => {
	for (const change of [{ restored: false }, { originalRecordsPreserved: false }, { timezone: "Europe/Amsterdam" }, { migrations: ["002_update_embedding_dimensions.sql"] }]) {
		assert.throws(() => preservationAssertion({ ...fixture(), ...change }), { message: "verified_utc_backup_required" });
	}
});

test("preservation checks cover every original table and exclude only the newly added voice flag", () => {
	const report = fixture();
	const sql = preservationAssertion(report);
	assert.equal((sql.match(/RAISE EXCEPTION/g) ?? []).length, 5);
	assert.match(sql, /to_jsonb\(t\) - 'needs_reconciliation'/);
	report.before.messages = { count: 0, fingerprint: null };
	assert.match(preservationAssertion(report), /IS DISTINCT FROM NULL/);
});

test("invalid fingerprint fields cannot inject SQL or skip table checks", () => {
	for (const value of [{ count: "3; DROP TABLE discord.messages", fingerprint: "a".repeat(32) }, { count: -1, fingerprint: "a".repeat(32) }, { count: 3, fingerprint: "'injected" }, undefined]) {
		const report = fixture();
		report.before.messages = value;
		assert.throws(() => preservationAssertion(report), { message: "invalid_backup_fingerprint" });
	}
});
