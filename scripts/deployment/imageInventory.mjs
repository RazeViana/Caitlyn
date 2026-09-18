/**
 * @file imageInventory.mjs
 * @description Lists installed package versions and paths inside a selected release container without network access.
 * Reads package metadata only; does not load the application, environment files or account configuration.
 *
 * @module deploymentImageInventory
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const npm = [];
const visited = new Set();
function scan(directory) {
	if (!existsSync(directory)) return;
	const resolved = realpathSync(directory);
	if (visited.has(resolved)) return;
	visited.add(resolved);
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const path = join(directory, entry.name);
		if (entry.name.startsWith("@")) {
			scan(path);
			continue;
		}
		const manifest = join(path, "package.json");
		if (!existsSync(manifest)) continue;
		const item = JSON.parse(readFileSync(manifest, "utf8"));
		npm.push({ name: item.name, version: item.version ?? "workspace", path });
		scan(join(path, "node_modules"));
	}
}
scan("/app/node_modules");
scan("/usr/local/lib/node_modules");
function command(binary, args) {
	try { return execFileSync(binary, args, { timeout: 60_000, maxBuffer: 4_194_304, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
	catch { return null; }
}
const alpine = existsSync("/lib/apk/db/installed");
const osPackages = command(alpine ? "apk" : "dpkg-query", alpine ? ["info", "-v"] : ["-W", "-f=${binary:Package}\t${Version}\n"]);
console.log(JSON.stringify({
	architecture: process.arch, node: process.version, nodePath: process.execPath, npmVersion: command("npm", ["--version"]),
	yarnVersion: command("yarn", ["--version"]), dockerCli: command("docker", ["--version"]),
	python: command("python3", ["--version"]), ffmpeg: command("ffmpeg", ["-version"])?.split("\n")[0] ?? null,
	pip: JSON.parse(command("/opt/extractor/bin/python", ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"]) ?? "null"),
	osFamily: alpine ? "Alpine" : "Debian", osPackages: osPackages?.split("\n").sort(),
	npmPackages: npm.sort((a, b) => a.path.localeCompare(b.path)),
}));
