/**
 * @file testSocialMediaLocal.ts
 * @description Orchestrates disposable local media tests in a dedicated Colima Docker context.
 * Verifies isolation before retrieval and removes only the containers/volumes it creates.
 *
 * @module testSocialMediaLocal
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import logger from "../core/logger.js";

const execute = promisify(execFile);
const context = "colima-caitlyn-media-test";
const image = "caitlyn-media-probe:local";
const cases: Record<string, string> = {
	"x-image": "https://x.com/TheHiddenOneAC/status/2097940988492664992",
	"x-gallery": "https://x.com/HeyShuggie/status/2097725753634755034",
	"x-video": "https://x.com/iClipCx/status/2097745425323209202",
	"x-text": "https://x.com/MasterLeytrx/status/2097877698894770267",
	"x-quote": "https://x.com/The_Kurieta/status/2097925042214457837",
	"tiktok-video": "https://www.tiktok.com/@nicoiscold/video/7675179840605015310",
	"instagram-post": "https://www.instagram.com/p/fA9uwTtkSN/",
	"instagram-reel": "https://www.instagram.com/reel/Chunk8-jurw/",
	"instagram-multi-video": "https://www.instagram.com/p/BQ0eAlwhDrw/",
};

async function docker(args: string[], timeout = 15_000): Promise<string> {
	try {
		const result = await execute("docker", ["--context", context, ...args], { timeout, killSignal: "SIGKILL", maxBuffer: 2 * 1_024 * 1_024 });
		return result.stdout.trim();
	}
	catch (error) {
		const code = (error as { code?: unknown }).code;
		throw new Error(`Docker ${args[0]} failed (exit ${typeof code === "number" ? code : "unavailable"})`, { cause: error });
	}
}

const restrictions = [
	"--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=1000:1000",
	"--log-driver=local", "--log-opt=max-size=64k", "--log-opt=max-file=2",
];

async function runCase(name: string, url: string): Promise<void> {
	const prefix = `caitlyn-media-${randomUUID()}`;
	const volume = `${prefix}-ipc`;
	const gateway = `${prefix}-gateway`;
	const worker = `${prefix}-worker`;
	const verifier = `${prefix}-verifier`;
	const ownedContainers: string[] = [];
	let volumeCreated = false;
	try {
		await docker(["volume", "create", "--label", "dev.caitlyn.media-test=true", volume]);
		volumeCreated = true;
		ownedContainers.push(gateway);
		await docker(["run", "-d", "--name", gateway, "--label", "dev.caitlyn.media-test=true", ...restrictions,
			"--memory=96m", "--memory-swap=96m", "--cpus=0.25", "--pids-limit=32",
			"--mount", `type=volume,source=${volume},target=/ipc`, image, "timeout", "-s", "KILL", "110", "node", "/opt/probe/gateway.ts"]);
		let ready = false;
		for (let attempt = 0; attempt < 30; attempt++) {
			try {
				await docker(["exec", gateway, "test", "-S", "/ipc/proxy.sock"]);
				ready = true;
				break;
			}
			catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
		}
		if (!ready) throw new Error("gateway_not_ready");
		const workerOptions = [
			...restrictions, "--network=none", "--memory=512m", "--memory-swap=512m", "--cpus=1", "--pids-limit=64",
			"--tmpfs", "/tmp:size=96m,mode=1777,nosuid,noexec", "--mount", `type=volume,source=${volume},target=/ipc,readonly`,
		];
		ownedContainers.push(verifier);
		const check = JSON.parse(await docker(["run", "--name", verifier, "--label", "dev.caitlyn.media-test=true", ...workerOptions,
			image, "node", "/opt/probe/worker.ts", "--isolation-check"]));
		if (!check.passed) throw new Error("isolation_check_failed");
		logger.info("Local media isolation passed", name, JSON.stringify(check.isolation));
		ownedContainers.push(worker);
		const result = JSON.parse(await docker(["run", "--name", worker, "--label", "dev.caitlyn.media-test=true", ...workerOptions,
			image, "timeout", "-s", "KILL", "75", "node", "/opt/probe/worker.ts", url], 85_000));
		const verified = result.outcome === "media_downloaded" && Array.isArray(result.files) && result.files.length > 0
			&& result.files.every((file: { firstTwoSecondsDecode?: boolean }) => file.firstTwoSecondsDecode);
		if (verified) logger.success("Local media result", name, JSON.stringify(result));
		else logger.warn("Local media result", name, JSON.stringify(result));
		const gatewayLog = await docker(["logs", gateway]);
		// Only fixed event categories and allowlisted hostnames are emitted by the gateway.
		logger.debug("Local media gateway", name, gatewayLog);
	}
	finally {
		for (const container of ownedContainers.reverse()) {
			await docker(["rm", "--force", container]).catch(() => { logger.warn("Local media cleanup needs attention", container); });
		}
		if (volumeCreated) {
			await docker(["volume", "rm", volume]).catch(() => { logger.warn("Local media volume cleanup needs attention", volume); });
		}
	}
}

export async function testSocialMediaLocal(args: string[]): Promise<void> {
	if (args.length > 1 || (args.length === 1 && !cases[args[0]])) throw new Error("Specify one known case name or no arguments for all cases");
	const endpoint = JSON.parse(await execute("docker", ["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"], { timeout: 5_000 }).then((result) => result.stdout));
	if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///") || !endpoint.endsWith("/.colima/caitlyn-media-test/docker.sock")) {
		throw new Error("Refusing a context that is not the dedicated local Colima socket");
	}
	logger.info("Building isolated local media image; only scripts/mediaSandbox enters the build context");
	await docker(["build", "--tag", image, fileURLToPath(new URL("./mediaSandbox/", import.meta.url))], 240_000);
	logger.info("Isolated local media image built");
	const versions = await docker(["run", "--rm", "--network=none", ...restrictions, image, "sh", "-c",
		"node --version && /opt/extractor/bin/yt-dlp --version && ffmpeg -version | head -1"]);
	logger.info("Local media tool versions", versions.replaceAll("\n", " | "));
	for (const [name, url] of Object.entries(cases)) {
		if (args.length === 0 || name === args[0]) await runCase(name, url);
	}
	logger.info("Local media checks finished; test containers, media tmpfs, and IPC volumes removed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await testSocialMediaLocal(process.argv.slice(2)).catch((error: unknown) => {
		const reason = error instanceof Error && /^(Docker |gateway_not_ready|isolation_check_failed|Specify |Refusing )/.test(error.message)
			? error.message : "unexpected harness response";
		logger.error("Local media harness failed:", reason, "No raw provider error was logged; review any cleanup warnings.");
		process.exitCode = 1;
	});
}
