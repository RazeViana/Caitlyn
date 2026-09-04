const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const tsxLoader = pathToFileURL(require.resolve("tsx")).href;

function runWithEnvironmentFile(environmentFile, source) {
	const fixtureRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "caitlyn-environment-"),
	);
	const childEnvironment = { ...process.env };

	for (const name of [
		"CONVERSATION_MEMORY_SIZE",
		"DOTENV_CONFIG_PATH",
		"OLLAMA_CHAT_ENDPOINT",
		"OLLAMA_MODEL",
		"PGDATABASE",
		"PGHOST",
		"PGPASSWORD",
		"PGPORT",
		"PGUSER",
	]) {
		delete childEnvironment[name];
	}

	try {
		fs.writeFileSync(path.join(fixtureRoot, ".env"), environmentFile);

		return execFileSync(
			process.execPath,
			["--import", tsxLoader, "--eval", source],
			{
				cwd: fixtureRoot,
				env: childEnvironment,
				encoding: "utf8",
			},
		).trim();
	}
	finally {
		fs.rmSync(fixtureRoot, { recursive: true, force: true });
	}
}

test("conversation storage loads its limit from .env on direct import", () => {
	const modulePath = path.resolve("core/conversationStore.ts");
	const output = runWithEnvironmentFile(
		"CONVERSATION_MEMORY_SIZE=1\n",
		[
			`const store = require(${JSON.stringify(modulePath)});`,
			"store.addMessage(\"direct-import\", \"user\", \"first\");",
			"store.addMessage(\"direct-import\", \"assistant\", \"second\");",
			"console.log(JSON.stringify(store.getConversation(\"direct-import\")));",
		].join("\n"),
	);

	assert.deepEqual(JSON.parse(output), [
		{ role: "assistant", content: "second" },
	]);
});

test("Ollama loads its endpoint and model from .env on direct import", () => {
	const modulePath = path.resolve("core/ollama.ts");
	const output = runWithEnvironmentFile(
		[
			"OLLAMA_CHAT_ENDPOINT=http://ollama.example.test/api/chat",
			"OLLAMA_MODEL=direct-import-model",
			"",
		].join("\n"),
		[
			"global.fetch = async (url, options) => ({",
			"\tasync json() {",
			"\t\treturn { message: { content: JSON.stringify({",
			"\t\t\turl,",
			"\t\t\tbody: JSON.parse(options.body),",
			"\t\t}) } };",
			"\t},",
			"});",
			`const { chat } = require(${JSON.stringify(modulePath)});`,
			"chat([{ role: \"user\", content: \"Hello\" }]).then(console.log);",
		].join("\n"),
	);

	assert.deepEqual(JSON.parse(output), {
		url: "http://ollama.example.test/api/chat",
		body: {
			model: "direct-import-model",
			messages: [{ role: "user", content: "Hello" }],
			stream: false,
		},
	});
});

test("PostgreSQL loads connection settings from .env on direct import", () => {
	const modulePath = path.resolve("core/createPGPool.ts");
	const output = runWithEnvironmentFile(
		[
			"PGHOST=database.example.test",
			"PGUSER=caitlyn-test-user",
			"PGPASSWORD=not-a-secret",
			"PGDATABASE=caitlyn-test-database",
			"PGPORT=5544",
			"",
		].join("\n"),
		[
			`const { pool } = require(${JSON.stringify(modulePath)});`,
			"const client = new pool.Client();",
			"console.log(JSON.stringify({",
			"\thost: client.connectionParameters.host,",
			"\tuser: client.connectionParameters.user,",
			"\tpassword: client.connectionParameters.password,",
			"\tdatabase: client.connectionParameters.database,",
			"\tport: client.connectionParameters.port,",
			"}));",
			"pool.end();",
		].join("\n"),
	);

	assert.deepEqual(JSON.parse(output), {
		host: "database.example.test",
		user: "caitlyn-test-user",
		password: "not-a-secret",
		database: "caitlyn-test-database",
		port: 5544,
	});
});
