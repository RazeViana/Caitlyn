/**
 * @file checkRelease.mjs
 * @description Checks required database tables and feature configuration without logging into Discord or changing data.
 * Runs before a release stops the existing bot; never prints credentials or stored records.
 *
 * @module checkDeploymentRelease
 */

import "../../dist/core/loadEnvironment.js";
import { pool } from "../../dist/core/createPGPool.js";
import { getFeatureConfiguration, validateEnvironment } from "../../dist/core/environment.js";

try {
	// Import the complete entry point before stopping the working bot. Its entry
	// guard keeps imports inert: no Discord login, handlers or scheduled jobs.
	const { startBot } = await import("../../dist/main.js");
	if (typeof startBot !== "function") throw new Error("release_entry_point_missing");
	validateEnvironment();
	const features = getFeatureConfiguration();
	if (!features.database.enabled || !features.socialMedia.enabled || features.ai.enabled
		|| !process.env.CLIENT_ID || !process.env.GUILD_ID) throw new Error("required_release_configuration_missing");
	await pool.query("BEGIN READ ONLY");
	for (const table of ["birthdays", "daily_activity", "messages", "user_activity", "voice_sessions", "guild_settings", "social_channels", "social_jobs", "birthday_deliveries", "birthday_occurrences"]) {
		await pool.query(`SELECT 1 FROM discord.${table} LIMIT 0`);
	}
	await pool.query("SELECT needs_reconciliation FROM discord.voice_sessions LIMIT 0");
	await pool.query("SELECT source_cleanup, replacement_ready FROM discord.social_jobs LIMIT 0");
	await pool.query("COMMIT");
	console.log("Release database check passed; AI is off; no Discord login or data changes");
}
catch {
	console.error("Release database/configuration check failed; the running bot has not been stopped");
	process.exitCode = 1;
}
finally { await pool.end(); }
