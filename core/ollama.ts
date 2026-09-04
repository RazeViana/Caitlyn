import type {
	ChatMessage,
	OllamaChatResponse,
} from "../types/models.js";

async function chat(messages: ChatMessage[]): Promise<string> {
	const response = await fetch(process.env.OLLAMA_CHAT_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: process.env.OLLAMA_MODEL,
			messages,
			stream: false,
		}),
	});
	const data = (await response.json()) as OllamaChatResponse;
	return data.message.content;
}

export { chat };
