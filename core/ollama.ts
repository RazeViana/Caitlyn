/**
 * @file ollama.ts
 * @description Sends conversation messages to the configured Open WebUI chat API.
 * Bounds requests, validates reply content, and propagates service failures to the caller.
 *
 * @module ollama
 */

import "./loadEnvironment.js";

import logger from "./logger.js";
import { dataErrorReason, logData } from "./dataLog.js";
import type { ChatMessage, OpenWebUIResponse } from "../types/models.js";

const OLLAMA_MODEL = process.env.OLLAMA_MODEL;
const WEBUI_CHAT_ENDPOINT = process.env.WEBUI_CHAT_ENDPOINT;
const WEBUI_API_KEY = process.env.WEBUI_API_KEY;

/**
 * Send chat messages to Open WebUI API
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} chatId - Optional chat ID for persistence (e.g., Discord channel ID)
 * @returns {Promise<string>} - AI response content
 */
export interface FetchDependencies {
	fetch: typeof globalThis.fetch;
}

interface OpenWebUIRequest {
	model: string;
	messages: ChatMessage[];
	stream: false;
	chat_id?: string;
}

async function chat(
	messages: ChatMessage[],
	chatId: string | null = null,
	dependencies: FetchDependencies = { fetch: globalThis.fetch },
): Promise<string> {
	if (!WEBUI_API_KEY) {
		logger.error("WEBUI_API_KEY is not set in environment variables");
		throw new Error("WEBUI_API_KEY is required for Open WebUI integration");
	}

	if (!WEBUI_CHAT_ENDPOINT) {
		logger.error("WEBUI_CHAT_ENDPOINT is not set in environment variables");
		throw new Error("WEBUI_CHAT_ENDPOINT is required");
	}

	// Build request body
	const requestBody: OpenWebUIRequest = {
		model: OLLAMA_MODEL,
		messages,
		stream: false,
	};

	// Add chat_id for persistence if provided
	if (chatId) {
		requestBody.chat_id = chatId;
	}

	if (!messages.length) throw new Error("Chat requires at least one message");
	logData("Sending messages to the AI service; text is not included in logs", { count: messages.length });

	try {
		const response = await dependencies.fetch(WEBUI_CHAT_ENDPOINT, {
			signal: AbortSignal.timeout(45_000),
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${WEBUI_API_KEY}`,
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`Open WebUI API returned ${response.status}`);
		}

		const data = await response.json() as OpenWebUIResponse;

		// Parse OpenAI-compatible response format
		if (typeof data?.choices?.[0]?.message?.content !== "string"
			|| !data.choices[0].message.content.trim()) {
			throw new Error("Invalid response format from Open WebUI API");
		}

		const reply = data.choices[0].message.content.replace(/^caitlyn:\s*/i, "").trim();
		if (!reply) throw new Error("Open WebUI returned an empty reply");
		logData("Received a reply from the AI service; text is not included in logs", { characters: reply.length });

		return reply;
	}
	catch (error) {
		logData("Could not get a reply from the AI service", { reason: dataErrorReason(error) }, logger.error);
		throw error;
	}
}

export { chat };
