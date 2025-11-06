/**
 * @file ollama.js
 * @description This module provides a function to interact with a local Ollama chat API.
 * It sends user input along with a system prompt to the Ollama model and awaits a response.
 *
 * @module ollama
 */

const OLLAMA_MODEL = process.env.OLLAMA_MODEL;
const OLLAMA_CHAT_ENDPOINT = process.env.OLLAMA_CHAT_ENDPOINT;

async function chat(messages) {
	// console.log(
	// 	`Sending messages to Ollama model:` +
	// 		messages.map((m) => `${m.content}`).join("\n")
	// );
	const response = await fetch(OLLAMA_CHAT_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: OLLAMA_MODEL,
			messages: messages,
			stream: false,
		}),
	});

	const data = await response.json();
	const reply = data.message.content;
	// console.log("Caitlyn: " + reply);

	return reply;
}

export { chat };
