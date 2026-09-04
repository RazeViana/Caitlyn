const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

process.env.OLLAMA_CHAT_ENDPOINT = "http://ollama.test/api/chat";
process.env.OLLAMA_MODEL = "caitlyn-test";

const originalFetch = global.fetch;
const { chat } = require("../core/ollama.ts");

afterEach(() => {
	global.fetch = originalFetch;
});

test("sends conversation history to Ollama and returns its reply", async () => {
	let request;
	global.fetch = async (url, options) => {
		request = { url, options };
		return {
			async json() {
				return { message: { content: "Hello from Caitlyn" } };
			},
		};
	};

	const reply = await chat([{ role: "user", content: "Hello" }]);

	assert.equal(reply, "Hello from Caitlyn");
	assert.equal(request.url, "http://ollama.test/api/chat");
	assert.deepEqual(JSON.parse(request.options.body), {
		model: "caitlyn-test",
		messages: [{ role: "user", content: "Hello" }],
		stream: false,
	});
});
