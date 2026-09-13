/**
 * @file socialFxCredentials.test.js
 * @description Verifies account parsing, encrypted runtime configuration and the local API trust boundary.
 * Uses synthetic sessions and temporary keys only; never opens 1Password or contacts X.
 *
 * @module socialFxCredentials.test
 */

import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encryptXSession, parseXSession } from "../scripts/fxEmbed/credentials.ts";
import { readLocalApiKey } from "../scripts/fxEmbed/localAccess.ts";
import { validateRuntimeSecrets } from "../scripts/fxEmbed/bootstrap.mjs";
import { createLocalFxService } from "../scripts/fxEmbed/service.mjs";
import { loadXSessionFromEnv, parseXSessionEnv } from "../scripts/fxEmbed/envSession.ts";

const session = { username: "local_fixture", authToken: "a".repeat(40), csrfToken: "b".repeat(160) };
const apiKey = "c".repeat(64);
const item = () => ({ fields: [{ label: "username", value: session.username }, { label: "auth_token", value: session.authToken }, { label: "ct0", value: session.csrfToken }] });
const envText = () => `FXEMBED_X_USERNAME=${session.username}\nFXEMBED_X_AUTH_TOKEN="${session.authToken}"\nFXEMBED_X_CT0='${session.csrfToken}'\n`;

test("local .env parsing accepts quoted X cookies but returns no unrelated bot settings", () => {
	const environmentBefore = { ...process.env };
	assert.deepEqual(parseXSessionEnv(envText() + "TOKEN=private-bot-token\nPGPASSWORD=private-db-password\n"), session);
	assert.equal(Object.keys(process.env).length === Object.keys(environmentBefore).length
		&& Object.entries(environmentBefore).every(([name, value]) => process.env[name] === value), true, "Parsing must not mutate the process environment");
	assert.deepEqual(parseXSessionEnv("# local account\n" + envText().replaceAll("\n", "\r\n")), session);
});

test("local .env missing, duplicate and malformed fields fail without exposing their values", () => {
	assert.throws(() => parseXSessionEnv(""), { message: "Missing FxEmbed .env fields: FXEMBED_X_USERNAME, FXEMBED_X_AUTH_TOKEN, FXEMBED_X_CT0" });
	assert.throws(() => parseXSessionEnv(envText() + "FXEMBED_X_CT0=private-cookie"), { message: "duplicate_fxembed_env_fields" });
	assert.throws(() => parseXSessionEnv(envText() + "export FXEMBED_X_AUTH_TOKEN=private-cookie"), { message: "duplicate_fxembed_env_fields" });
	assert.throws(() => parseXSessionEnv(envText().replace(session.csrfToken, "private-invalid-value")), (error) => !error.message.includes("private-invalid-value"));
	assert.throws(() => parseXSessionEnv("#".repeat(65_537)), { message: "fxembed_env_file_too_large" });
});

test("local .env session loading requires a bounded, private, non-symlink file", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-fx-env-test-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const file = join(directory, ".env");
	await writeFile(file, envText(), { mode: 0o600 });
	assert.deepEqual(await loadXSessionFromEnv(file), session);
	await chmod(file, 0o644);
	await assert.rejects(loadXSessionFromEnv(file), { message: "fxembed_env_file_must_be_owner_only_0600" });
	await chmod(file, 0o600);
	await symlink(file, join(directory, "link"));
	await assert.rejects(loadXSessionFromEnv(join(directory, "link")), { message: "fxembed_env_file_unreadable" });
	await assert.rejects(loadXSessionFromEnv(join(directory, "missing")), { message: "fxembed_env_file_unreadable" });
	await writeFile(file, "x".repeat(65_537));
	await assert.rejects(loadXSessionFromEnv(file), { message: "fxembed_env_file_too_large" });
});

test("1Password session parsing requires exact, unique fields and cookie-safe values", () => {
	assert.deepEqual(parseXSession(item()), session);
	for (const value of [null, {}, { fields: [] }, { fields: [...item().fields, item().fields[1]] }]) assert.throws(() => parseXSession(value));
	for (const [index, value] of [[0, "user@example.test"], [0, "@handle"], [1, "a".repeat(40) + ";evil=1"], [2, "\r\nCookie: secret"], [2, ""], [2, 42]]) {
		const invalid = item();
		invalid.fields[index].value = value;
		assert.throws(() => parseXSession(invalid), (error) => ["invalid_x_session_fields", "missing_or_duplicate_x_session_field"].includes(error.message));
	}
});

test("runtime ciphertext decrypts using upstream-compatible AES-GCM and contains exactly one account", async () => {
	const config = encryptXSession(session, apiKey);
	assert.deepEqual(validateRuntimeSecrets(config), config);
	assert.notEqual(encryptXSession(session, apiKey).ENCRYPTED_CREDENTIALS, config.ENCRYPTED_CREDENTIALS);
	const key = await crypto.subtle.importKey("raw", Buffer.from(config.CREDENTIAL_KEY, "base64url"), "AES-GCM", false, ["decrypt"]);
	const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(config.CREDENTIALS_IV, "base64") }, key, Buffer.from(config.ENCRYPTED_CREDENTIALS, "base64"));
	assert.deepEqual(JSON.parse(new TextDecoder().decode(decrypted)), { twitter: { accounts: [session] } });
	assert.equal(JSON.stringify(config).includes(session.authToken), false);
	const tampered = Buffer.from(config.ENCRYPTED_CREDENTIALS, "base64");
	tampered[0] ^= 1;
	await assert.rejects(crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(config.CREDENTIALS_IV, "base64") }, key, tampered));
});

test("bootstrap rejects incomplete, oversized, injected and unknown configuration without values in errors", () => {
	assert.deepEqual(validateRuntimeSecrets({}), {});
	const config = encryptXSession(session, apiKey);
	for (const invalid of [null, [], { CREDENTIAL_KEY: "private" }, { ...config, remote: true }, { ...config, CAITLYN_API_KEY: "secret\r\n" },
		{ ...config, CREDENTIALS_IV: "short" }, { ...config, ENCRYPTED_CREDENTIALS: "a".repeat(9000) }]) {
		assert.throws(() => validateRuntimeSecrets(invalid), { message: "invalid_runtime_configuration" });
	}
});

test("local keys require an owner-only directory and regular non-symlink bounded file", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-fx-key-test-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const file = join(directory, "key");
	await writeFile(file, apiKey, { mode: 0o600 });
	assert.equal(await readLocalApiKey(file), apiKey);
	await chmod(file, 0o644);
	await assert.rejects(readLocalApiKey(file));
	await chmod(file, 0o600);
	await chmod(directory, 0o755);
	await assert.rejects(readLocalApiKey(file));
	await chmod(directory, 0o700);
	await symlink(file, join(directory, "link"));
	await assert.rejects(readLocalApiKey(join(directory, "link")));
	await writeFile(file, apiKey + "\n");
	await assert.rejects(readLocalApiKey(file));
	await assert.rejects(readLocalApiKey("relative-key"));
});

function fixture() {
	const calls = { initialized: 0, upstream: 0, probe: 0 };
	let failure = false;
	const app = { fetch: async (request, env) => {
		calls.upstream++;
		assert.equal(request.headers.get("x-caitlyn-key"), null);
		assert.equal(request.headers.get("cookie"), null);
		assert.equal(request.headers.get("origin"), null);
		assert.equal(new URL(request.url).hostname, "caitlyn-fxembed.invalid");
		assert.deepEqual(Object.keys(env), ["CREDENTIAL_KEY"]);
		return Response.json({ code: 200 }, { headers: { "Access-Control-Allow-Origin": "*" } });
	} };
	const credentials = { initCredentials: async () => {
		calls.initialized++;
		if (failure) throw new Error("secret upstream details");
	}, hasDecryptedCredentials: () => !failure };
	const service = createLocalFxService(app, credentials, async () => { calls.probe++; });
	const env = encryptXSession(session, apiKey);
	const request = (path = "/2/status/123", key = apiKey, method = "GET") => new Request("http://127.0.0.1:8787" + path, {
		method, headers: { "x-caitlyn-key": key, Cookie: "caller=secret", Origin: "https://evil.test" },
	});
	return { calls, service, env, request, fail: () => { failure = true; } };
}

test("authenticated backend rejects missing/wrong local keys before account initialization or upstream I/O", async () => {
	const f = fixture();
	for (const key of ["", "d".repeat(64), apiKey.slice(1)]) {
		assert.equal((await f.service.fetch(f.request("/2/status/123", key), f.env, {})).status, 401);
		assert.equal((await f.service.fetch(f.request("/__caitlyn/health", key), f.env, {})).status, 401);
	}
	assert.deepEqual(f.calls, { initialized: 0, upstream: 0, probe: 0 });
});

test("backend initializes once, removes local secrets from forwarded headers and reports honest health", async () => {
	const f = fixture();
	const health = await f.service.fetch(f.request("/__caitlyn/health"), f.env, {});
	assert.deepEqual(await health.json(), { service: "fxembed", ready: true, accountConfigured: true });
	const response = await f.service.fetch(f.request(), f.env, {});
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.equal(response.headers.get("access-control-allow-origin"), null);
	assert.deepEqual(f.calls, { initialized: 1, upstream: 1, probe: 1 });
});

test("backend fails closed for broken credentials without guest fallback, raw errors or false readiness", async () => {
	const f = fixture();
	f.fail();
	for (const path of ["/__caitlyn/health", "/2/status/123"]) {
		const response = await f.service.fetch(f.request(path), f.env, {});
		assert.equal(response.status, 503);
		assert.deepEqual(await response.json(), { reason: "local_backend_unavailable" });
	}
	assert.equal(f.calls.upstream, 0);
	assert.equal(f.calls.initialized, 1);
	assert.equal((await f.service.fetch(f.request(), { CREDENTIAL_KEY: "only_one_secret" }, {})).status, 503);
});

test("anonymous health stays explicit and unsupported routes/methods never contact X", async () => {
	const f = fixture();
	const health = await f.service.fetch(f.request("/__caitlyn/health", ""), {}, {});
	assert.deepEqual(await health.json(), { service: "fxembed", ready: true, accountConfigured: false });
	for (const path of ["/2/profile/123", "/2/status/123?private=1", "/__caitlyn/health?x=1", "/2/status/0"]) assert.equal((await f.service.fetch(f.request(path), f.env, {})).status, 404);
	assert.equal((await f.service.fetch(f.request("/2/status/123", apiKey, "POST"), f.env, {})).status, 405);
	assert.equal(f.calls.upstream, 0);
});
