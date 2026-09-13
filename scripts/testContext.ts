/**
 * @file testContext.ts
 * @description Inspects recent and semantic conversation context for a fixed diagnostic prompt.
 * Prints the chat payload using configured services only when explicitly invoked.
 *
 * @module testContext
 */

import "../core/loadEnvironment.js";

import { pathToFileURL } from "node:url";
import { getConversationContext } from "../core/messageStore.js";
import type { ChatMessage } from "../types/models.js";

async function testContext(): Promise<void> {
	// Test values for a known channel and memory prompt.
	const channelId = "1152942687603933285";
	const testMessage = "whats my fav colour?";

	console.log(`\n🔍 Testing context retrieval for: "${testMessage}"\n`);

	try {
		const context = await getConversationContext({
			channelId,
			currentMessage: testMessage,
			recentCount: 8,
			similarCount: 3,
		});

		console.log(`📋 Retrieved ${context.length} context messages:\n`);

		for (const message of context) {
			console.log(`[${message.created_at.toISOString()}] ${message.username} (${message.role})${message.source ? ` [${message.source}]` : ""}:`);
			console.log(`  ${message.content}`);
			if (message.similarity) {
				console.log(`  Similarity: ${message.similarity.toFixed(3)}`);
			}
			console.log();
		}

		// Build the messages array like caitlynAI does
		console.log("\n📤 Messages array that would be sent to Open WebUI:\n");
		const messages: ChatMessage[] = [];
		for (const contextMessage of context) {
			messages.push({
				role: contextMessage.role,
				content: `${contextMessage.username}: ${contextMessage.content}`,
			});
		}
		messages.push({
			role: "user",
			content: `tonymate: ${testMessage}`,
		});

		console.log(JSON.stringify(messages, null, 2));
	}
	catch (error: unknown) {
		console.error("Error:", error);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void testContext();
}

export { testContext };
