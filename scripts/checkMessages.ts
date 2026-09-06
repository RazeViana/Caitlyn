/**
 * @file checkMessages.ts
 * @description Prints stored-message counts, embedding coverage, and recent message previews.
 * Queries the configured database only when explicitly invoked.
 *
 * @module checkMessages
 */

import "dotenv/config";

import { pathToFileURL } from "node:url";
import { pool } from "../core/createPGPool.js";

interface ChannelMessageCount {
	channel_id: string;
	message_count: string;
	with_embeddings: string;
	latest_message: Date | null;
}

interface RecentMessage {
	channel_id: string;
	username: string;
	role: string;
	content_preview: string;
	created_at: Date;
}

async function checkMessages(): Promise<void> {
	try {
		// Count messages per channel
		const countResult = await pool.query<ChannelMessageCount>(`
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
		}
		else {
			for (const row of countResult.rows) {
				console.log(`Channel: ${row.channel_id}`);
				console.log(`  Messages: ${row.message_count}`);
				console.log(`  With embeddings: ${row.with_embeddings}`);
				console.log(`  Latest: ${row.latest_message}`);
				console.log();
			}
		}

		// Show recent messages
		const recentResult = await pool.query<RecentMessage>(`
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
		for (const message of recentResult.rows) {
			console.log(`[${message.created_at.toISOString()}] ${message.username} (${message.role}): ${message.content_preview}...`);
		}

		await pool.end();
	}
	catch (error: unknown) {
		console.error("Error:", error);
		process.exit(1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void checkMessages();
}

export { checkMessages };
