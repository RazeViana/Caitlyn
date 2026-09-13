/**
 * @file manage.ts
 * @description Builds or starts Caitlyn's loopback-only FxEmbed service using an allowlisted source context.
 * Optional account credentials come from a private .env or 1Password item over stdin, never Docker settings or builds.
 *
 * @module fxEmbedManage
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encryptXSession, loadXSession } from "./credentials.js";
import { checkPrivateParent, readLocalApiKey } from "./localAccess.js";
import { loadXSessionFromEnv } from "./envSession.js";

const [action, context = "default", sourceOrKeyFile, item, accountKeyFile] = process.argv.slice(2);
const keyFile = action === "start-env" ? sourceOrKeyFile : accountKeyFile;
if (!["build", "start", "start-account", "start-env"].includes(action) || !/^[a-zA-Z0-9_.-]{1,80}$/.test(context)
	|| (action === "start-account" ? process.argv.length !== 7 : action === "start-env" ? process.argv.length !== 5 : process.argv.length > 4)) throw new Error("invalid_fxembed_options");
// Even explicitly exported X settings must not be inherited by Docker CLI subprocesses.
const dockerEnvironment = { ...process.env };
for (const name of Object.keys(dockerEnvironment)) {
	if (name.startsWith("FXEMBED_X_")) delete dockerEnvironment[name];
}
const docker = (args: string[], timeout = 10_000, stdin?: string): Promise<string> => new Promise((resolve, reject) => {
	const child = execFile("docker", ["--context", context, ...args], { timeout, env: dockerEnvironment, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
		if (error) reject(new Error("local_docker_operation_failed"));
		else resolve(stdout.trim());
	});
	child.stdin?.on("error", () => {
		// Completion reports a closed pipe without exposing input.
	});
	child.stdin?.end(stdin);
});
const endpoint = JSON.parse(await docker(["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"]));
if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///")) throw new Error("fxembed_requires_local_docker");
if (action === "build") {
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-fxembed-build-"));
	try {
		const source = fileURLToPath(new URL("../../vendor/fxembed/", import.meta.url));
		for (const name of ["package.json", "package-lock.json", "src", "i18n", "packages", "branding.example.json"]) {
			await cp(join(source, name), join(directory, name), { recursive: true, filter: (entry) => !/(?:^|\/)(?:node_modules|dist)(?:\/|$)/.test(entry) });
		}
		for (const name of ["Dockerfile", "build.mjs", "wrangler.toml", "entry.mjs", "service.mjs", "bootstrap.mjs"]) await copyFile(fileURLToPath(new URL(name, import.meta.url)), join(directory, name));
		await copyFile(fileURLToPath(new URL("../../docs/licenses/FxEmbed.txt", import.meta.url)), join(directory, "LICENSE"));
		console.log(await docker(["build", "--tag", "caitlyn-fxembed:local", directory], 300_000));
	}
	finally { await rm(directory, { recursive: true, force: true }); }
}
else {
	if (await docker(["ps", "-aq", "--filter", "name=^/caitlyn-fxembed$"])) throw new Error("fxembed_container_already_exists_review_before_replacing");
	const image = await docker(["image", "inspect", "caitlyn-fxembed:local", "--format", "{{.Id}}"]);
	if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("invalid_fxembed_image");
	let apiKey: string | undefined;
	let configuration = {};
	if (action === "start-account" || action === "start-env") {
		await checkPrivateParent(keyFile);
		const session = action === "start-env" ? await loadXSessionFromEnv(fileURLToPath(new URL("../../.env", import.meta.url))) : await loadXSession(sourceOrKeyFile, item);
		try { apiKey = await readLocalApiKey(keyFile); }
		catch (error) {
			if ((error as { code?: string }).code !== "ENOENT") throw error;
			apiKey = randomBytes(32).toString("hex");
			await writeFile(keyFile, apiKey, { flag: "wx", mode: 0o600 });
		}
		configuration = encryptXSession(session, apiKey);
	}
	const container = await docker(["run", "-d", "--name", "caitlyn-fxembed", "--label=dev.caitlyn.fxembed=true", "--pull=never",
		"--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=1000:1000", "--log-driver=none",
		"--memory=768m", "--memory-swap=768m", "--cpus=1", "--pids-limit=128",
		"--tmpfs", "/tmp:size=96m,mode=1777,nosuid", "--tmpfs", "/app/.wrangler:size=96m,uid=1000,gid=1000,mode=700,nosuid", "-p", "127.0.0.1:8787:8787", image]);
	let ready = false;
	try {
		await docker(["exec", "-i", container, "node", "/app/bootstrap.mjs", "--configure"], 10_000, JSON.stringify(configuration));
		for (let attempt = 0; attempt < 40; attempt++) {
			try {
				const response = await fetch("http://127.0.0.1:8787/__caitlyn/health", { signal: AbortSignal.timeout(1000), redirect: "error", headers: apiKey ? { "x-caitlyn-key": apiKey } : {} });
				const health = await response.json() as { service?: string; ready?: boolean; accountConfigured?: boolean };
				if (response.ok && health.service === "fxembed" && health.ready === true && health.accountConfigured === Boolean(apiKey)) {
					ready = true;
					break;
				}
			}
			catch {
				// The local runtime is still starting.
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	catch {
		// Cleanup below removes only this newly created container.
	}
	if (!ready) {
		if (/^[a-f0-9]{64}$/.test(container)) await docker(["rm", "--force", container]);
		throw new Error("fxembed_startup_failed_created_container_removed");
	}
	console.log("Local FxEmbed ready; accountConfigured=" + Boolean(apiKey));
}
