/**
 * @file embeddingService.ts
 * @description Service for generating text embeddings using a local embedding model.
 * Connects to a local embedding endpoint (Ollama or similar) to convert text into vector embeddings.
 *
 * @module embeddingService
 */

import "dotenv/config";

import logger from "./logger.js";
import type { EmbeddingResponse } from "../types/models.js";

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
const EMBEDDING_ENDPOINT = process.env.EMBEDDING_ENDPOINT;

/**
 * Generate embedding vector for text
 * @param {string} text - Text to generate embedding for
 * @returns {Promise<number[]>} - Embedding vector
 */
export interface FetchDependencies {
	fetch: typeof globalThis.fetch;
}

async function generateEmbedding(
	text: string,
	dependencies: FetchDependencies = { fetch: globalThis.fetch },
): Promise<number[]> {
	if (!text || text.trim().length === 0) {
		throw new Error("Cannot generate embedding for empty text");
	}

	try {
		logger.debug(
			`Generating embedding for text: "${text.substring(0, 20)}..."`,
		);

		const response = await dependencies.fetch(EMBEDDING_ENDPOINT, {
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

		const data = await response.json() as EmbeddingResponse;

		// Extract embedding from response
		// Format depends on the embedding service
		const embedding = data.embedding;

		if (!embedding || !Array.isArray(embedding)) {
			throw new Error("Invalid embedding response format");
		}

		logger.debug("Generated embedding");
		return embedding;
	}
	catch (error) {
		logger.error("Error generating embedding:", error);
		throw error;
	}
}

/**
 * Generate embeddings for multiple texts in batch
 * @param {string[]} texts - Array of texts to generate embeddings for
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
async function generateEmbeddings(
	texts: string[],
	dependencies: FetchDependencies = { fetch: globalThis.fetch },
): Promise<number[][]> {
	if (!Array.isArray(texts) || texts.length === 0) {
		throw new Error("texts must be a non-empty array");
	}

	logger.debug("Generating embeddings");

	try {
		// Generate embeddings sequentially to avoid overwhelming the server
		const embeddings: number[][] = [];
		for (const text of texts) {
			const embedding = await generateEmbedding(text, dependencies);
			embeddings.push(embedding);
		}

		return embeddings;
	}
	catch (error) {
		logger.error("Error generating batch embeddings:", error);
		throw error;
	}
}

export { generateEmbedding, generateEmbeddings };
