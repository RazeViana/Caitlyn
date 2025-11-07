import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool();

async function testMemory() {
	const channelId = process.argv[2];

	if (!channelId) {
		console.log("Usage: node scripts/testMemory.js <channel_id>");
		console.log("\nThis will clear all messages from the specified channel.");
		process.exit(1);
	}

	try {
		// Delete all messages for this channel
		const result = await pool.query(
			"DELETE FROM discord.messages WHERE channel_id = $1",
			[channelId]
		);

		console.log(`✓ Cleared ${result.rowCount} messages from channel ${channelId}`);
		console.log("\nNow test the memory by:");
		console.log("1. Tell Caitlyn a unique fact (e.g., 'my favorite pizza is pepperoni')");
		console.log("2. Have a few other conversations");
		console.log("3. Ask Caitlyn to recall the fact (e.g., 'what's my favorite pizza?')");
		console.log("\nIf it works, Caitlyn should remember the fact from earlier!");

		await pool.end();
	} catch (error) {
		console.error("Error:", error);
		process.exit(1);
	}
}

testMemory();
