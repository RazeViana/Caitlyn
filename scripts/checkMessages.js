import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool();

async function checkMessages() {
	try {
		// Count messages per channel
		const countResult = await pool.query(`
			SELECT
				channel_id,
				COUNT(*) as message_count,
				COUNT(embedding) as with_embeddings,
				MAX(created_at) as latest_message
			FROM discord.messages
			GROUP BY channel_id
		`);

		console.log("\n📊 Messages by Channel:");
		console.log("========================");
		if (countResult.rows.length === 0) {
			console.log("No messages found in database");
		} else {
			for (const row of countResult.rows) {
				console.log(`Channel: ${row.channel_id}`);
				console.log(`  Messages: ${row.message_count}`);
				console.log(`  With embeddings: ${row.with_embeddings}`);
				console.log(`  Latest: ${row.latest_message}`);
				console.log();
			}
		}

		// Show recent messages
		const recentResult = await pool.query(`
			SELECT
				channel_id,
				username,
				role,
				LEFT(content, 50) as content_preview,
				created_at
			FROM discord.messages
			ORDER BY created_at DESC
			LIMIT 10
		`);

		console.log("\n📝 Recent Messages:");
		console.log("==================");
		for (const msg of recentResult.rows) {
			console.log(`[${msg.created_at.toISOString()}] ${msg.username} (${msg.role}): ${msg.content_preview}...`);
		}

		await pool.end();
	} catch (error) {
		console.error("Error:", error);
		process.exit(1);
	}
}

checkMessages();
