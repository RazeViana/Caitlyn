/**
 * @file deployment.test.js
 * @description Checks private restart configuration, stale socket handling and production service isolation.
 * Uses only synthetic secrets and temporary local sockets; never contacts a server or Discord.
 *
 * @module deployment.test
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { test } from "node:test";
import { encryptXSession } from "../scripts/fxEmbed/credentials.ts";
import { readRuntimeSecrets } from "../scripts/fxEmbed/bootstrap.mjs";
import { removeStaleSocket } from "../scripts/deployment/startBroker.mjs";
import { createDeploymentCompose } from "../scripts/deployment/compose.mjs";

const fixture = () => encryptXSession({ username: "fixture", authToken: "a".repeat(40), csrfToken: "b".repeat(32) }, "c".repeat(64));
async function temporary(context) {
	const directory = await mkdtemp(join(tmpdir(), "cait-deploy-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

test("persistent FxEmbed configuration is reread without consuming its private file", async (context) => {
	const file = join(await temporary(context), "runtime.json");
	const config = fixture();
	await writeFile(file, JSON.stringify(config), { mode: 0o600 });
	assert.deepEqual(await readRuntimeSecrets(file), config);
	assert.deepEqual(await readRuntimeSecrets(file), config);
	assert.deepEqual(JSON.parse(await readFile(file, "utf8")), config);
});

test("persistent secrets reject permissive files/directories, symlinks and oversized input", async (context) => {
	const directory = await temporary(context);
	const file = join(directory, "runtime.json");
	await writeFile(file, JSON.stringify(fixture()), { mode: 0o600 });
	await chmod(file, 0o644);
	await assert.rejects(readRuntimeSecrets(file));
	await chmod(file, 0o600);
	await chmod(directory, 0o755);
	await assert.rejects(readRuntimeSecrets(file));
	await chmod(directory, 0o700);
	await symlink(file, join(directory, "link"));
	await assert.rejects(readRuntimeSecrets(join(directory, "link")));
	await writeFile(file, "x".repeat(16_385));
	await assert.rejects(readRuntimeSecrets(file));
});

test("malformed persistent configuration never includes file contents in its error", async (context) => {
	const file = join(await temporary(context), "runtime.json");
	await writeFile(file, "sensitive-malformed-fixture", { mode: 0o600 });
	await assert.rejects(readRuntimeSecrets(file), { message: "invalid_runtime_secret_contents" });
});

test("socket preparation accepts absence but never removes a regular file or symlink", async (context) => {
	const directory = await temporary(context);
	const file = join(directory, "worker.sock");
	assert.equal(await removeStaleSocket(file), false);
	await writeFile(file, "keep", { mode: 0o600 });
	await assert.rejects(removeStaleSocket(file));
	assert.equal(await readFile(file, "utf8"), "keep");
	await symlink(file, join(directory, "link"));
	await assert.rejects(removeStaleSocket(join(directory, "link")));
});

test("socket preparation refuses a live private listener", async (context) => {
	const file = join(await temporary(context), "worker.sock");
	const server = createServer((socket) => { socket.destroy(); });
	server.listen(file);
	await once(server, "listening");
	context.after(() => new Promise((resolve) => server.close(resolve)));
	await chmod(file, 0o600);
	await assert.rejects(removeStaleSocket(file), { message: "worker_socket_active_or_uncertain" });
	assert.equal((await lstat(file)).isSocket(), true);
});

test("socket preparation removes only a private socket left by a terminated process", async (context) => {
	const file = join(await temporary(context), "worker.sock");
	const child = spawn(process.execPath, ["--input-type=module", "-e", "import net from 'node:net'; net.createServer().listen(process.argv[1],()=>process.stdout.write('ready'));", file], { stdio: ["ignore", "pipe", "ignore"] });
	context.after(() => { child.kill("SIGKILL"); });
	await once(child.stdout, "data");
	await chmod(file, 0o600);
	const exited = once(child, "exit");
	child.kill("SIGKILL");
	await exited;
	assert.equal(await removeStaleSocket(file), true);
	await assert.rejects(lstat(file), { code: "ENOENT" });
});

test("deployment stages media without a bot by default and never grants the bot Docker/X secrets", () => {
	const options = { root: "/mnt/pool/caitlyn/runtime", dockerGroup: 999, images: Object.fromEntries(["bot", "broker", "fxembed", "media"].map((key) => [key, "sha256:" + "a".repeat(64)])) };
	assert.equal(createDeploymentCompose(options).services.caitlyn, undefined);
	const { services } = createDeploymentCompose({ ...options, activateBot: true });
	assert.equal(services.caitlyn.environment.LLM_ENABLED, "false");
	assert.equal(services.broker.network_mode, "service:fxembed");
	assert.equal(services.fxembed.environment.CAITLYN_FX_LOOPBACK_ONLY, "true");
	assert.equal(services.fxembed.ports, undefined);
	assert.equal(services.caitlyn.volumes.some((mount) => /docker|\/fx$|\/key$/.test(mount.source)), false);
	assert.equal(services.broker.volumes.filter((mount) => mount.source === "/var/run/docker.sock").length, 1);
	assert.equal(services.broker.volumes.some((mount) => /\/fx$|\/bot$/.test(mount.source)), false);
	for (const service of Object.values(services)) {
		assert.equal(service.pull_policy, "never");
		assert.equal(service.read_only, true);
		assert.equal(service.labels["com.centurylinklabs.watchtower.enable"], "false");
	}
	assert.throws(() => createDeploymentCompose({ ...options, images: { ...options.images, bot: "latest" } }));
	assert.throws(() => createDeploymentCompose({ ...options, root: "/mnt/../../etc" }));
});
