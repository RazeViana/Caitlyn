import "dotenv/config";
import { getConversationContext } from "../core/messageStore.js";

async function testContext() {
	const channelId = "1152942687603933285"; // Your test channel
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

		for (const msg of context) {
			console.log(`[${msg.created_at.toISOString()}] ${msg.username} (${msg.role})${msg.source ? ` [${msg.source}]` : ''}:`);
			console.log(`  ${msg.content}`);
			if (msg.similarity) {
				console.log(`  Similarity: ${msg.similarity.toFixed(3)}`);
			}
			console.log();
		}

		// Build the messages array like caitlynAI.js does
		console.log("\n📤 Messages array that would be sent to Open WebUI:\n");
		const messages = [];
		for (const ctx of context) {
			messages.push({
				role: ctx.role,
				content: `${ctx.username}: ${ctx.content}`,
			});
		}
		messages.push({
			role: "user",
			content: `tonymate: ${testMessage}`,
		});

		console.log(JSON.stringify(messages, null, 2));

	} catch (error) {
		console.error("Error:", error);
	}
}

testContext();
