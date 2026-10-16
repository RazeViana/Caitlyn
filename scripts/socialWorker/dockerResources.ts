/**
 * @file dockerResources.ts
 * @description Recovers only disposable workers belonging to this private broker socket directory.
 * Docker can finish creating a container after its CLI times out; names alone do not prove ownership.
 */

import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export type DockerCommand = (args: string[], timeout?: number, signal?: AbortSignal, stdin?: string) => Promise<string>;
export const WORKER_LABEL = "dev.caitlyn.social-worker";
export const OWNER_LABEL = "dev.caitlyn.social-owner";
export const JOB_LABEL = "dev.caitlyn.social-job";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const lines = (text: string): string[] => text.split(/\s+/).filter(Boolean);

export async function workerOwner(socketPath: string, context: string): Promise<string> {
	if (!isAbsolute(socketPath) || Buffer.byteLength(socketPath) > 100 || /[\p{Cc}]/u.test(socketPath)) throw new Error("invalid_worker_socket");
	const parent = await lstat(dirname(socketPath));
	if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0) throw new Error("worker_socket_directory_must_be_private");
	// A bind mount retains this identity across container/image replacements. Other instances use other directories.
	return createHash("sha256").update(`${context}:${parent.dev}:${parent.ino}:${parent.uid}`).digest("hex");
}

export function jobLabels(owner: string, job: string): string[] {
	if (!/^[a-f0-9]{64}$/.test(owner) || !uuid.test(job)) throw new Error("invalid_worker_owner");
	return [`--label=${WORKER_LABEL}=true`, `--label=${OWNER_LABEL}=${owner}`, `--label=${JOB_LABEL}=${job}`];
}

type Container = {
	Id: string; Name: string;
	Config: { User: string; Labels: Record<string, string> };
	HostConfig: { ReadonlyRootfs: boolean; Privileged: boolean; NetworkMode: string; Binds?: string[]; Devices?: unknown[] };
	Mounts: { Type: string; Name?: string; Destination: string }[];
};
type Volume = { Name: string; Driver: string; Scope: string; Options?: Record<string, string> | null; Labels?: Record<string, string> | null };

/** Refuse foreign/ambiguous resources; never prune, remove bind data, or force-remove a volume. */
export async function recoverDockerResources(command: DockerCommand, owner: string): Promise<{ containers: number; volumes: number }> {
	if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error("invalid_worker_owner");
	const deadline = Date.now() + 12_000;
	const docker: DockerCommand = (args, timeout = 12_000) => {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error("worker_docker_timeout");
		return command(args, Math.min(timeout, remaining));
	};
	const filters = [`--filter=label=${WORKER_LABEL}=true`, `--filter=label=${OWNER_LABEL}=${owner}`];
	const ids = lines(await docker(["ps", "-aq", "--no-trunc", ...filters]));
	const names = lines(await docker(["volume", "ls", "-q", ...filters]));
	if (ids.length > 32 || names.length > 32 || ids.some((id) => !/^[a-f0-9]{64}$/.test(id))) throw new Error("worker_cleanup_required");
	const containers: Container[] = ids.length ? JSON.parse(await docker(["inspect", ...ids])) : [];
	if (!Array.isArray(containers) || containers.length !== ids.length) throw new Error("worker_cleanup_required");
	const volumes = new Map<string, string>();
	for (const container of containers) {
		const labels = container.Config?.Labels;
		const job = labels?.[JOB_LABEL];
		const match = container.Name?.match(/^\/caitlyn-social-([a-f0-9-]+)-(gateway|worker|verifier)$/);
		if (!job || !uuid.test(job) || labels?.[OWNER_LABEL] !== owner || labels?.[WORKER_LABEL] !== "true"
			|| !ids.includes(container.Id) || match?.[1] !== job || container.Config.User !== "1000:1000"
			|| container.HostConfig?.ReadonlyRootfs !== true || container.HostConfig.Privileged !== false
			|| container.HostConfig.NetworkMode !== (match[2] === "gateway" ? "bridge" : "none")
			|| container.HostConfig.Binds?.length || container.HostConfig.Devices?.length
			|| container.Mounts?.length !== 1 || container.Mounts[0].Type !== "volume"
			|| container.Mounts[0].Name !== `caitlyn-social-${job}-ipc` || container.Mounts[0].Destination !== "/ipc") throw new Error("worker_cleanup_required");
		volumes.set(`caitlyn-social-${job}-ipc`, job);
	}
	for (const name of names) {
		const job = name.match(/^caitlyn-social-([a-f0-9-]+)-ipc$/)?.[1];
		if (!job || !uuid.test(job)) throw new Error("worker_cleanup_required");
		volumes.set(name, job);
	}
	// Validate the whole set before removing anything. A late Docker create can recreate an unlabelled volume;
	// that volume is attributable only when a validated worker references it and no foreign container does.
	for (const [name, job] of volumes) {
		const inspected: Volume[] = JSON.parse(await docker(["volume", "inspect", name]));
		const volume = inspected[0];
		const labels = volume?.Labels;
		const labelled = labels?.[OWNER_LABEL] === owner && labels?.[JOB_LABEL] === job && labels?.[WORKER_LABEL] === "true";
		const referenced = containers.some((container) => container.Mounts[0].Name === name);
		if (inspected.length !== 1 || volume.Name !== name || volume.Driver !== "local" || volume.Scope !== "local"
			|| Object.keys(volume.Options ?? {}).length || (!labelled && !(referenced && !Object.keys(labels ?? {}).length))) throw new Error("worker_cleanup_required");
		const attached = lines(await docker(["ps", "-aq", "--no-trunc", `--filter=volume=${name}`]));
		if (attached.some((id) => !ids.includes(id))) throw new Error("worker_cleanup_required");
	}
	for (const container of containers) {
		try { await docker(["rm", "--force", container.Id], 30_000); }
		catch (error) {
			// An auto-removed worker may have exited between listing and removal.
			if (lines(await docker(["ps", "-aq", "--no-trunc", `--filter=id=${container.Id}`])).includes(container.Id)) throw error;
		}
	}
	for (const name of volumes.keys()) {
		try { await docker(["volume", "rm", name], 30_000); }
		catch (error) {
			if (lines(await docker(["volume", "ls", "-q", `--filter=name=${name}`])).includes(name)) throw error;
		}
	}
	return { containers: containers.length, volumes: volumes.size };
}
