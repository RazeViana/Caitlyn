/**
 * @file testInstagramMediaOffline.ts
 * @description Runs synthetic Instagram parser/downloader fixtures in an existing network-disabled worker image.
 * Sends one source file on stdin, exposes no host mounts or credentials, and logs only verified test counts.
 *
 * @module testInstagramMediaOffline
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import logger from "../core/logger.js";

export async function testInstagramMediaOffline(context = "colima-caitlyn-media-test"): Promise<void> {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(context)) throw new Error("invalid_fixture_context");
	const docker = (args: string[], input?: string): Promise<string> => new Promise((resolve, reject) => {
		const child = execFile("docker", ["--context", context, ...args], { timeout: 25_000, killSignal: "SIGKILL", maxBuffer: 32_768,
			env: { PATH: process.env.PATH, DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? join(homedir(), ".docker") } as unknown as NodeJS.ProcessEnv }, (error, stdout) => {
			if (error) reject(new Error("offline_instagram_fixture_failed"));
			else resolve(stdout.trim());
		});
		child.stdin?.on("error", () => {
			// Completion handles a closed pipe without forwarding provider diagnostics.
		});
		child.stdin?.end(input);
	});
	const endpoint = JSON.parse(await docker(["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"]));
	if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///")) throw new Error("fixture_requires_local_docker");
	const image = await docker(["image", "inspect", "caitlyn-media-instagram:local", "--format", "{{.Id}}"]);
	if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("fixture_requires_existing_image");
	const source = await readFile(new URL("./mediaSandbox/instagramMediaFixture.py", import.meta.url), "utf8");
	const name = `caitlyn-instagram-fixture-${randomUUID()}`;
	let created = false;
	try {
		await docker(["create", "-i", "--name", name, "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
			"--user=1000:1000", "--memory=128m", "--memory-swap=128m", "--cpus=1", "--pids-limit=32", "--log-driver=none",
			"--tmpfs", "/tmp:size=8m,mode=1777,nosuid,noexec", image, "timeout", "-s", "KILL", "20", "/opt/extractor/bin/python", "-B", "-"]);
		created = true;
		const result = JSON.parse(await docker(["start", "--attach", "--interactive", name], source));
		if (result.outcome !== "verified" || result.tests !== 10 || result.failures !== 0 || result.errors !== 0) throw new Error("invalid_fixture_result");
		logger.success("Offline Instagram parser/download checks passed", "tests=10", "network=none");
	}
	finally {
		if (created) {
			await docker(["rm", "--force", name]);
			logger.info("Owned Instagram fixture container and temporary test media removed");
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try { await testInstagramMediaOffline(process.argv[2]); }
	catch {
		logger.error("Offline Instagram checks failed; review cached image, local Docker access and fixture cleanup. No packages installed.");
		process.exitCode = 1;
	}
}
