/**
 * @file ollama.js
 * @description This module provides a function to interact with Open WebUI API.
 * Supports web search, memory, and persistent chat history features.
 *
 * @module ollama
 */

import logger from "./logger.js";

const OLLAMA_MODEL = process.env.OLLAMA_MODEL;
const WEBUI_CHAT_ENDPOINT = process.env.WEBUI_CHAT_ENDPOINT;
const WEBUI_API_KEY = process.env.WEBUI_API_KEY;

/**
 * Send chat messages to Open WebUI API
 * @param {Array} messages - Array of message objects with role and content
 * @param {string} chatId - Optional chat ID for persistence (e.g., Discord channel ID)
 * @returns {Promise<string>} - AI response content
 */
async function chat(messages, chatId = null) {
  if (!WEBUI_API_KEY) {
    logger.error("WEBUI_API_KEY is not set in environment variables");
    throw new Error("WEBUI_API_KEY is required for Open WebUI integration");
  }

  if (!WEBUI_CHAT_ENDPOINT) {
    logger.error("WEBUI_CHAT_ENDPOINT is not set in environment variables");
    throw new Error("WEBUI_CHAT_ENDPOINT is required");
  }

  // Build request body
  const requestBody = {
    model: OLLAMA_MODEL,
    messages: messages,
    stream: false,
  };

  // Add chat_id for persistence if provided
  if (chatId) {
    requestBody.chat_id = chatId;
  }

  logger.debug(`Sending request to Open WebUI ${messages[0].content}`);

  try {
    const response = await fetch(WEBUI_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WEBUI_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Open WebUI API error (${response.status}): ${errorText}`);
      throw new Error(
        `Open WebUI API returned ${response.status}: ${errorText}`,
      );
    }

    const data = await response.json();

    // Parse OpenAI-compatible response format
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      logger.error("Invalid response format from Open WebUI:", data);
      throw new Error("Invalid response format from Open WebUI API");
    }

    const reply = data.choices[0].message.content.replace(/^caitlyn:\s*/i, "");
    logger.debug(`Received response from Open WebUI ${reply}`);

    return reply;
  } catch (error) {
    logger.error("Error communicating with Open WebUI:", error);
  }
}

export { chat };
