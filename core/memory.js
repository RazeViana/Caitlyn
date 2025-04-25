/**
 * @file memory.js
 * @description This module provides functions to interact with a memory collection
 * using embeddings. It includes functionality to create a collection, add memory,
 * and query the most similar memory using embeddings.
 *
 * The embedding model used is "nomic-embed-text"
 * The database used to store the collection is ChromaDB.
 *
 * Notes:
 *
 * Delete Collection
 * `curl -X DELETE http://192.168.2.43:30075/api/v2/tenants/default/databases/default/collections/caitlyn_memory`
 *
 * List Collections
 * curl http://192.168.2.43:30075/api/v2/tenants/default/databases/default/collections
 *
 *
 * @module memory
 */

const CHROMA_BASE_URL = "http://192.168.2.43:30075/api/v2";
const EMBEDDING_API_URL = "http://192.168.2.43:30068/api/embeddings";
const TENANT = "default";
const DB = "default";
const COLLECTION_NAME = "caitlyn_memory";
const COLLECTION_BASE = `${CHROMA_BASE_URL}/tenants/${TENANT}/databases/${DB}/collections`;

let cachedCollectionId = null;

// Get embedding from local Ollama
async function getEmbedding(text) {
	const res = await fetch(EMBEDDING_API_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "nomic-embed-text",
			prompt: text,
		}),
	});

	// Check if the response is ok
	if (!res.ok) {
		const err = await res.text();
		throw new Error(`[ERROR] Failed to get embedding: ${res.status} - ${err}`);
	}

	// Check if the response is JSON
	const json = await res.json();

	return json;
}

// Create the memory collection if needed
async function createCollection() {
	// get one sample embedding length
	const sampleVec = await getEmbedding("init");
	// Should be 768 ~ nomic-embed-text
	const vecDim = sampleVec.length;

	const res = await fetch(COLLECTION_BASE, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name: COLLECTION_NAME,
			dimension: vecDim,
			metadata: {
				created_by: "Raze",
				created: new Date().toISOString(),
				description: "Memory collection for caitlyn",
			},
		}),
	});

	// Check if the response is ok
	if (res.status === 409) {
		console.log("[INFO] Memory found, skipping creation");
		return;
	}

	// Check if the response is JSON
	if (!res.ok) {
		const txt = await res.text();
		throw new Error(`[ERROR] ${res.status} ${res.statusText} - ${txt}`);
	}
	console.log("[INFO] Memory created with dimension", vecDim);
}

// Get collection ID from Chroma
async function getCollectionId() {
	// Check if we already have the collection ID cached
	if (cachedCollectionId) return cachedCollectionId;

	// Fetch the collection list from Chroma
	const res = await fetch(COLLECTION_BASE);
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`[ERROR] ${res.status} ${res.statusText} - ${text}`);
	}

	// Check if the response is JSON
	const data = await res.json();
	if (!Array.isArray(data)) {
		throw new Error("Invalid response format from Chroma.");
	}

	// Find the collection with the specified name
	const collection = data.find((c) => c.name === COLLECTION_NAME);
	if (!collection)
		throw new Error(`[ERROR] Memory collection "${COLLECTION_NAME}" not found`);

	// Cache the collection ID for future use
	cachedCollectionId = collection.id;
	return cachedCollectionId;
}

// Store embedded memory
async function addMemory(text, id, metadata = {}) {
	const collectionId = await getCollectionId();
	const embedding = await getEmbedding(text);

	const res = await fetch(`${COLLECTION_BASE}/${collectionId}/add`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			ids: [id],
			embeddings: [embedding],
			metadatas: [metadata],
			documents: [text], // still useful to keep raw text
		}),
	});

	// Check if the response is ok
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`[ERROR] Failed to add memory: ${res.status} - ${text}`);
	}

	console.debug("[DEBUG] Memory saved");
}

// Query most similar memory
async function queryMemory(queryText, n = 1) {
	const collectionId = await getCollectionId();
	const embedding = await getEmbedding(queryText);

	const res = await fetch(`${COLLECTION_BASE}/${collectionId}/query`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			query_embeddings: [embedding],
			n_results: n,
		}),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`[ERROR] Failed to query memory: ${res.status} - ${text}`);
	}

	const data = await res.json();
	const match = data.documents?.[0]?.[0];
	console.log("[INFO] Closest memory:", match);
	return match;
}

module.exports = {
	createCollection,
	addMemory,
	queryMemory,
};
