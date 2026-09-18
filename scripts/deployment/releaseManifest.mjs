/**
 * @file releaseManifest.mjs
 * @description Records a matching set of immutable release images, migration hashes and installed package inventories.
 * The mainframe accepts only completed releases with the database migration set it has already reviewed.
 *
 * @module releaseManifest
 */

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function migrationFingerprint(directory) {
	const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
	if (files.some((name) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(name))) throw new Error("unexpected_migration_filename");
	if (!files.length) throw new Error("migrations_missing");
	const entries = await Promise.all(files.map(async (name) => [name, createHash("sha256").update(await readFile(join(directory, name))).digest("hex")]));
	return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

export function releaseImages(repository, digests) {
	if (!/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9_.-]*$/.test(repository)) throw new Error("invalid_release_repository");
	return Object.fromEntries(["bot", "broker", "fxembed", "media"].map((name) => {
		if (!/^sha256:[a-f0-9]{64}$/.test(digests[name] ?? "")) throw new Error("missing_release_digest");
		return [name, `ghcr.io/${repository}${name === "bot" ? "" : "-" + name}@${digests[name]}`];
	}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const revision = process.env.GITHUB_SHA;
	const repository = process.env.GITHUB_REPOSITORY;
	if (!/^[a-f0-9]{40}$/.test(revision ?? "") || !repository) throw new Error("release_identity_missing");
	const images = releaseImages(repository.toLowerCase(), Object.fromEntries(["bot", "broker", "fxembed", "media"].map((name) => [name, process.env[name.toUpperCase() + "_DIGEST"]])));
	const inventories = {};
	for (const name of Object.keys(images)) {
		const inventory = JSON.parse(await readFile(`release/${name}-inventory.json`, "utf8"));
		if (!inventory.osPackages?.length || !inventory.npmPackages?.length || inventory.architecture !== "x64") throw new Error("incomplete_release_inventory");
		inventories[name] = { image: images[name], ...inventory };
	}
	const packages = JSON.stringify({ revision, scope: "Container packages only; no host package installation", images: inventories }, null, 2) + "\n";
	await writeFile("release/caitlyn-installations.json", packages);
	await writeFile("release/caitlyn-release.json", JSON.stringify({ version: 1, repository, revision, platform: "linux/amd64", images,
		migrationHash: await migrationFingerprint("migrations"), inventoryHash: createHash("sha256").update(packages).digest("hex") }, null, 2) + "\n");
}
