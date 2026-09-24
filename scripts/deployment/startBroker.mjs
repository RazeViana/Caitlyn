/**
 * @file startBroker.mjs
 * @description Starts the compiled broker after checking for a stale owner-only socket from a stopped process.
 * Refuses live or ambiguous sockets and leaves orphaned Docker resources for explicit operator review.
 * Restarts the broker after sustained local FxEmbed connection loss to rejoin its network namespace.
 *
 * @module startBroker
 */

import { spawn } from "node:child_process";
import { lstat, unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { watchFxConnection } from "./fxConnectionWatchdog.mjs";

export async function removeStaleSocket(file) {
	if (typeof file !== "string" || !isAbsolute(file) || Buffer.byteLength(file) > 100 || /[\p{Cc}]/u.test(file)) throw new Error("invalid_worker_socket");
	const parent = await lstat(dirname(file));
	if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077) !== 0) throw new Error("worker_directory_not_private");
	const before = await lstat(file).catch((error) => {
		if (error.code !== "ENOENT") throw error;
	});
	if (!before) return false;
	if (!before.isSocket() || before.uid !== process.getuid() || (before.mode & 0o077) !== 0) throw new Error("unexpected_worker_socket");
	const result = await new Promise((resolve) => {
		const socket = createConnection(file);
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(value);
		};
		socket.setTimeout(1_000, () => finish("unknown"));
		socket.once("connect", () => finish("live"));
		socket.once("error", (error) => finish(error.code === "ECONNREFUSED" ? "stale" : "unknown"));
	});
	if (result !== "stale") throw new Error("worker_socket_active_or_uncertain");
	const after = await lstat(file);
	if (!after.isSocket() || after.ino !== before.ino || after.dev !== before.dev || after.uid !== before.uid) throw new Error("worker_socket_changed");
	await unlink(file);
	return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		if (await removeStaleSocket(process.env.SOCIAL_WORKER_SOCKET)) console.log("Removed a stale private worker socket; no active listener found");
		const child = spawn(process.execPath, ["/app/dist/scripts/socialWorker/server.js"], { stdio: "inherit" });
		let recovering = false;
		const stopWatch = process.env.SOCIAL_FXEMBED_URL ? watchFxConnection({
			origin: process.env.SOCIAL_FXEMBED_URL,
			onUnavailable: () => {
				recovering = true;
				console.warn("Local FxEmbed connection lost for three checks; restarting broker to rejoin its network");
				// The worker stops accepting jobs and cleans up active work before Docker restarts us.
				child.kill("SIGTERM");
			},
		}) : undefined;
		for (const signal of ["SIGTERM", "SIGINT"]) {
			process.once(signal, () => {
				stopWatch?.();
				child.kill(signal);
			});
		}
		child.once("error", () => {
			stopWatch?.();
			process.exitCode = 1;
		});
		child.once("exit", (code) => {
			stopWatch?.();
			process.exitCode = recovering ? 1 : code ?? 1;
		});
	}
	catch {
		console.error("Media worker could not start; check its private socket and existing worker processes");
		process.exitCode = 1;
	}
}
