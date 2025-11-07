/**
 * @file embeddingService.js
 * @description Service for generating text embeddings using a local embedding model.
 * Connects to a local embedding endpoint (Ollama or similar) to convert text into vector embeddings.
 *
 * @module embeddingService
 */

import logger from "./logger.js";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
const EMBEDDING_ENDPOINT = process.env.EMBEDDING_ENDPOINT;

/**
 * Generate embedding vector for text
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<number[]>} - Embedding vector
 */
async function generateEmbedding(text) {
  if (!text || text.trim().length === 0) {
    throw new Error("Cannot generate embedding for empty text");
  }

  try {
    logger.debug(
      `Generating embedding for text: "${text.substring(0, 20)}..."`,
    );

    const response = await fetch(EMBEDDING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Embedding API returned ${response.status}: ${errorText}`,
      );
    }

    const data = await response.json();

    // Extract embedding from response
    // Format depends on the embedding service
    const embedding = data.embedding;

    if (!embedding || !Array.isArray(embedding)) {
      throw new Error("Invalid embedding response format");
    }

    logger.debug(`Generated embedding`);
    return embedding;
  } catch (error) {
    logger.error("Error generating embedding:", error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in batch
 * @param {string[]} texts - Array of texts to generate embeddings for
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
async function generateEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("texts must be a non-empty array");
  }

  logger.debug(`Generating embeddings`);

  try {
    // Generate embeddings sequentially to avoid overwhelming the server
    const embeddings = [];
    for (const text of texts) {
      const embedding = await generateEmbedding(text);
      embeddings.push(embedding);
    }

    return embeddings;
  } catch (error) {
    logger.error("Error generating batch embeddings:", error);
    throw error;
  }
}

export { generateEmbedding, generateEmbeddings };
