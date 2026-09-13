/**
 * @file buildSocialWorkerImage.ts
 * @description Builds the private media API image offline from an explicit source allowlist and cached dependencies.
 * Refuses remote Docker engines, missing base images, and changed dependency layers; never copies bot secrets.
 *
 * @module buildSocialWorkerImage
 */

import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import logger from "../core/logger.js";

const execute = promisify(execFile);

export async function buildSocialWorkerImage(context: string, baseline: string, target = "caitlyn-media-api:local"): Promise<string> {
	if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(context) || !/^caitlyn-media-[a-z0-9_.-]{1,64}:local$/.test(target)
		|| !/^(?:caitlyn-media-[a-z0-9_.-]{1,64}:local|sha256:[a-f0-9]{64})$/.test(baseline)) throw new Error("invalid_build_options");
	const docker = async (args: string[]): Promise<string> => (await execute("docker", ["--context", context, ...args], {
		timeout: 120_000, killSignal: "SIGKILL", maxBuffer: 4 * 1_024 * 1_024,
	})).stdout;
	const endpoint = JSON.parse(await docker(["context", "inspect", context, "--format", "{{json .Endpoints.docker.Host}}"]));
	if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///")) throw new Error("build_requires_local_docker");
	const source = fileURLToPath(new URL("./mediaSandbox/", import.meta.url));
	const recipe = await readFile(join(source, "Dockerfile"), "utf8");
	const base = recipe.match(/^FROM (\S+@sha256:[a-f0-9]{64})$/m)?.[1];
	if (!base) throw new Error("build_requires_pinned_base");
	// --pull=false alone can still fetch an absent base. Require it to be present before building.
	await docker(["image", "inspect", base]);
	const previous = JSON.parse(await docker(["image", "inspect", baseline]))[0];
	const directory = await mkdtemp(join(tmpdir(), "caitlyn-media-build-"));
	try {
		for (const name of ["Dockerfile", ".dockerignore", "requirements.txt", "gateway.ts", "worker.ts", "xPostWorker.ts", "xMetadata.py", "tikTokPostWorker.ts", "tikTokMedia.py"]) {
			await copyFile(join(source, name), join(directory, name));
		}
		await copyFile(fileURLToPath(new URL("../core/socialXPost.ts", import.meta.url)), join(directory, "socialXPost.ts"));
		await copyFile(fileURLToPath(new URL("../core/socialFxPost.ts", import.meta.url)), join(directory, "socialFxPost.ts"));
		await copyFile(fileURLToPath(new URL("../core/socialTikTokPost.ts", import.meta.url)), join(directory, "socialTikTokPost.ts"));
		// Build without a tag so a failed verification cannot replace a working image reference.
		const output = await docker(["build", "--quiet", "--network=none", "--pull=false", directory]);
		const imageId = output.trim();
		if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("unexpected_build_result");
		const current = JSON.parse(await docker(["image", "inspect", imageId]))[0];
		if (!Array.isArray(previous.RootFS?.Layers) || !Array.isArray(current.RootFS?.Layers)
			|| JSON.stringify(previous.RootFS.Layers.slice(0, -1)) !== JSON.stringify(current.RootFS.Layers.slice(0, -1))) {
			throw new Error("dependency_layers_changed_review_required");
		}
		await docker(["tag", imageId, target]);
		logger.success("Private media source image built; nothing installed", imageId, `reused_dependency_layers=${current.RootFS.Layers.length - 1}`);
		return imageId;
	}
	finally {
		await rm(directory, { recursive: true, force: true });
		logger.info("Owned temporary media build directory removed");
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		if (process.argv.length > 5) throw new Error("invalid_build_options");
		await buildSocialWorkerImage(process.argv[2] ?? "default", process.argv[3] ?? "caitlyn-media-probe:local", process.argv[4]);
	}
	catch {
		logger.error("Private media build failed; check local context, cached pinned base/dependencies, and build options. No online installation attempted.");
		process.exitCode = 1;
	}
}
