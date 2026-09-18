/**
 * @file prepareBundle.mjs
 * @description Creates isolated build contexts from an exact Git commit, with explicitly requested local overlays only.
 * Never includes the local environment, private backups, node_modules or parked feature edits.
 *
 * @module prepareDeploymentBundle
 */

import { execFileSync } from "node:child_process";
import { cp, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const revision = process.argv[2];
const overlaysRequested = process.argv[3] === "--working-overlays";
if (!/^[a-f0-9]{40}$/.test(revision ?? "") || process.argv.length !== (overlaysRequested ? 4 : 3)) throw new Error("require_exact_release_commit");
execFileSync("git", ["cat-file", "-e", revision + "^{commit}"], { cwd: repository });
const directory = await mkdtemp(join(tmpdir(), "caitlyn-mainframe-release-"));
const source = join(directory, "source");
await mkdir(source, { mode: 0o700 });
const archive = execFileSync("git", ["archive", revision], { cwd: repository, maxBuffer: 32 * 1_024 * 1_024 });
execFileSync("tar", ["-xf", "-", "-C", source], { input: archive });
const overlays = overlaysRequested ? ["scripts/fxEmbed/bootstrap.mjs", "scripts/fxEmbed/healthcheck.mjs",
	"scripts/deployment/Dockerfile", "scripts/deployment/Dockerfile.fxembed", "scripts/deployment/Dockerfile.media",
	"scripts/deployment/tsconfig.json", "scripts/deployment/startBroker.mjs", "scripts/deployment/brokerHealth.mjs", "scripts/deployment/compose.mjs",
	"scripts/deployment/prepareBundle.mjs", "scripts/deployment/checkRelease.mjs", "tests/deployment.test.js"] : [];
for (const path of overlays) {
	await mkdir(join(source, path, ".."), { recursive: true });
	await copyFile(join(repository, path), join(source, path));
}
const fx = join(directory, "fxembed");
await mkdir(fx, { mode: 0o700 });
for (const name of ["package.json", "package-lock.json", "src", "i18n", "packages", "branding.example.json"]) await cp(join(source, "vendor/fxembed", name), join(fx, name), { recursive: true });
for (const name of ["entry.mjs", "service.mjs", "bootstrap.mjs", "healthcheck.mjs", "build.mjs", "wrangler.toml"]) await copyFile(join(source, "scripts/fxEmbed", name), join(fx, name));
await copyFile(join(source, "docs/licenses/FxEmbed.txt"), join(fx, "LICENSE"));
await copyFile(join(source, "scripts/deployment/Dockerfile.fxembed"), join(fx, "Dockerfile"));
const media = join(directory, "media");
await mkdir(media, { mode: 0o700 });
for (const name of ["requirements.txt", "gateway.ts", "worker.ts", "xPostWorker.ts", "xMetadata.py", "tikTokPostWorker.ts", "tikTokMedia.py", "instagramPostWorker.ts", "instagramMedia.py", "videoCompression.ts", "videoDelivery.ts"]) await copyFile(join(source, "scripts/mediaSandbox", name), join(media, name));
for (const name of ["socialXPost.ts", "socialFxPost.ts", "socialTikTokPost.ts", "socialInstagramPost.ts"]) await copyFile(join(source, "core", name), join(media, name));
await copyFile(join(source, "scripts/deployment/Dockerfile.media"), join(media, "Dockerfile"));
await writeFile(join(directory, "release.json"), JSON.stringify({ revision, overlays }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(directory);
