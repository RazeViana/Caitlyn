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

test("Discord login reads the call-time token and handles rejected logins", async () => {
	const originalToken = process.env.TOKEN;
	const originalConsoleError = console.error;
	const loginTokens = [];
	const loggedErrors = [];
	const unhandledRejections = [];
	let rejectLogin;
	const loginPromise = new Promise((_resolve, reject) => {
		rejectLogin = reject;
	});
	const unhandledRejectionHandler = (reason) => {
		unhandledRejections.push(reason);
	};

	process.env.TOKEN = "dummy-call-time-token";
	console.error = (...args) => {
		loggedErrors.push(args.join(" "));
	};
	process.on("unhandledRejection", unhandledRejectionHandler);

	try {
		const result = loginClient({
			login(token) {
				loginTokens.push(token);
				return loginPromise;
			},
		});

		assert.deepEqual(loginTokens, ["dummy-call-time-token"]);
		assert.equal(result, undefined);

		rejectLogin(new Error("dummy login rejection"));
		await new Promise((resolve) => setImmediate(resolve));

		assert.equal(loggedErrors.length, 1);
		assert.match(loggedErrors[0], /Error logging in:.*dummy login rejection/s);
		assert.deepEqual(unhandledRejections, []);
	}
	finally {
		process.env.TOKEN = originalToken;
		console.error = originalConsoleError;
		process.off("unhandledRejection", unhandledRejectionHandler);
	}
});

test("embedding requests preserve endpoint, model, and response vector", async () => {
	const requests = [];
	const fakeFetch = async (url, options) => {
		requests.push({ url, options });
		return new Response(JSON.stringify({ embedding: [0.125, -0.5, 0.75] }), {
			headers: { "Content-Type": "application/json" },
			status: 200,
		});
	};

	const embedding = await generateEmbedding("hello embeddings", { fetch: fakeFetch });

	assert.deepEqual(embedding, [0.125, -0.5, 0.75]);
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
