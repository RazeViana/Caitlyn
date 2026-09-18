/**
 * @file coreServices.test.js
 * @description Tests PostgreSQL probing, AI state, Discord login, embeddings, and chat requests.
 * Uses mocked connections and HTTP responses without contacting external services.
 *
 * @module coreServices.test
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

process.env.EMBEDDING_ENDPOINT = "https://embedding.invalid/api/embeddings";
process.env.EMBEDDING_MODEL = "dummy-embedding-model";
process.env.LLM_ENABLED = "false";
process.env.OLLAMA_MODEL = "dummy-chat-model";
process.env.PGDATABASE = "dummy_database";
process.env.PGHOST = "localhost";
process.env.PGPASSWORD = "dummy_password";
process.env.PGPORT = "5432";
process.env.PGUSER = "dummy_user";
process.env.TOKEN = "dummy-import-token";
process.env.WEBUI_API_KEY = "dummy-webui-key";
process.env.WEBUI_CHAT_ENDPOINT = "https://webui.invalid/api/chat/completions";

const { createPGPool, pool } = await import("../core/createPGPool.ts");
const {
	disableAI,
	enableAI,
	isAIEnabled,
	resetAIState,
	toggleAI,
} = await import("../core/aiState.ts");
const { generateEmbedding } = await import("../core/embeddingService.ts");
const { loginClient } = await import("../core/loginClient.ts");
const { chat } = await import("../core/ollama.ts");

const originalPoolQuery = pool.query.bind(pool);

afterEach(() => {
	pool.query = originalPoolQuery;
	process.env.LLM_ENABLED = "false";
	resetAIState();
});

test("PostgreSQL initialization probes SELECT NOW without opening a real service", async () => {
	const queries = [];
	pool.query = async (query) => {
		queries.push(query);
		return { rows: [{ now: new Date("2026-09-04T00:00:00.000Z") }] };
	};

	await createPGPool();

	assert.deepEqual(queries, ["SELECT NOW()"]);
});

test("AI state honors LLM_ENABLED and toggles in memory", () => {
	assert.equal(isAIEnabled(), false);
	assert.equal(enableAI(), true);
	assert.equal(isAIEnabled(), true);
	assert.equal(toggleAI(), false);
	assert.equal(disableAI(), false);

	process.env.LLM_ENABLED = "true";
	resetAIState();
	assert.equal(isAIEnabled(), true);
});

test("AI defaults to disabled without LLM_ENABLED and resets to that default", () => {
	delete process.env.LLM_ENABLED;
	resetAIState();
	assert.equal(isAIEnabled(), false);
	assert.equal(toggleAI(), true);
	resetAIState();
	assert.equal(isAIEnabled(), false);
});

test("Discord login stays pending until completion and propagates rejection", async () => {
	const originalToken = process.env.TOKEN;
	let rejectLogin;
	const promise = new Promise((_resolve, reject) => { rejectLogin = reject; });
	process.env.TOKEN = "dummy-call-time-token";
	try {
		let settled = false;
		const login = loginClient({ isReady: () => false, once: () => undefined, off: () => undefined, login: (token) => {
			assert.equal(token, "dummy-call-time-token");
			return promise;
		} });
		const observed = login.finally(() => { settled = true; });
		const rejection = assert.rejects(observed, /login rejected/);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settled, false);
		rejectLogin(new Error("login rejected"));
		await rejection;
	}
	finally {
		process.env.TOKEN = originalToken;
	}
});

test("embedding requests preserve endpoint, model, and response vector", async () => {
	const requests = [];
	const fakeFetch = async (url, options) => {
		requests.push({ url, options });
		return new Response(JSON.stringify({ embedding: Array.from({ length: 768 }, () => 0.125) }), {
			headers: { "Content-Type": "application/json" },
			status: 200,
		});
	};

	const embedding = await generateEmbedding("hello embeddings", { fetch: fakeFetch });

	assert.deepEqual(embedding, Array.from({ length: 768 }, () => 0.125));
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, "https://embedding.invalid/api/embeddings");
	assert.equal(requests[0].options.method, "POST");
	assert.deepEqual(JSON.parse(requests[0].options.body), {
		model: "dummy-embedding-model",
		prompt: "hello embeddings",
	});
});

test("Open WebUI chat preserves auth, chat_id, and reply normalization", async () => {
	const requests = [];
	const fakeFetch = async (url, options) => {
		requests.push({ url, options });
		return new Response(JSON.stringify({
			choices: [{ message: { content: "Caitlyn: Normalized reply" } }],
		}), {
			headers: { "Content-Type": "application/json" },
			status: 200,
		});
	};
	const messages = [{ role: "user", content: "Hello Caitlyn" }];

	const reply = await chat(messages, "dummy-chat-id", { fetch: fakeFetch });

	assert.equal(reply, "Normalized reply");
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, "https://webui.invalid/api/chat/completions");
	assert.equal(requests[0].options.headers.Authorization, "Bearer dummy-webui-key");
	assert.deepEqual(JSON.parse(requests[0].options.body), {
		model: "dummy-chat-model",
		messages,
		stream: false,
		chat_id: "dummy-chat-id",
	});
});
