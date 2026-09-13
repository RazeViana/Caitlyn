/**
 * @file testMemory.ts
 * @description Clears stored messages for an explicitly supplied channel and prints manual memory-test steps.
 * This operational diagnostic deletes data in the configured database when run.
 *
 * @module testMemory
 */

import "../core/loadEnvironment.js";

import { pathToFileURL } from "node:url";
import { pool } from "../core/createPGPool.js";

async function testMemory(channelId = process.argv[2]): Promise<void> {
	if (!channelId) {
		console.log("Usage: npx tsx scripts/testMemory.ts <channel_id>");
		console.log("\nThis will clear all messages from the specified channel.");
		process.exit(1);
	}

	try {
		// Delete all messages for this channel
		const result = await pool.query(
			"DELETE FROM discord.messages WHERE channel_id = $1",
			[channelId],
		);

		console.log(`✓ Cleared ${result.rowCount} messages from channel ${channelId}`);
		console.log("\nNow test the memory by:");
		console.log("1. Tell Caitlyn a unique fact (e.g., 'my favorite pizza is pepperoni')");
		console.log("2. Have a few other conversations");
		console.log("3. Ask Caitlyn to recall the fact (e.g., 'what's my favorite pizza?')");
		console.log("\nIf it works, Caitlyn should remember the fact from earlier!");

		await pool.end();
	}
	catch (error: unknown) {
		console.error("Error:", error);
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void testMemory();
}

export { testMemory };
