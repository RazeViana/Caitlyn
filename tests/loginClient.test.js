const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const modulePath = require.resolve("../core/loginClient.ts");
const originalToken = process.env.TOKEN;
const originalDotenvConfigPath = process.env.DOTENV_CONFIG_PATH;

function loadLoginClient(token) {
	delete require.cache[modulePath];
	delete require.cache[require.resolve("dotenv/config")];

	if (token === undefined) {
		delete process.env.TOKEN;
		process.env.DOTENV_CONFIG_PATH = "missing-login-client-test.env";
	}
	else {
		process.env.TOKEN = token;
	}

	return require("../core/loginClient.ts");
}

afterEach(() => {
	delete require.cache[modulePath];

	if (originalToken === undefined) {
		delete process.env.TOKEN;
	}
	else {
		process.env.TOKEN = originalToken;
	}

	if (originalDotenvConfigPath === undefined) {
		delete process.env.DOTENV_CONFIG_PATH;
	}
	else {
		process.env.DOTENV_CONFIG_PATH = originalDotenvConfigPath;
	}
});

test("throws a clear error when TOKEN is missing during module load", () => {
	assert.throws(
		() => loadLoginClient(undefined),
		{ message: "No TOKEN found. Set a TOKEN environment variable" },
	);
});

test("throws a clear error when loginClient has no client", () => {
	const { loginClient } = loadLoginClient("test-token");

	assert.throws(
		() => loginClient(undefined),
		{ message: "Client is not defined" },
	);
});
