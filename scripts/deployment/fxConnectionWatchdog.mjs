/**
 * @file fxConnectionWatchdog.mjs
 * @description Detects a lost local FxEmbed listener so the broker can rejoin its replaced network namespace.
 * Makes bounded local TCP probes without requesting post content or reading credentials.
 *
 * @module fxConnectionWatchdog
 */
import { createConnection } from "node:net";

export function checkFxConnection(origin, timeoutMs = 2_000) {
	if (typeof origin !== "string" || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/.test(origin)) throw new Error("invalid_local_fx_origin");
	const port = Number(new URL(origin).port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("invalid_local_fx_port");
	return new Promise((resolve) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		const finish = (connected) => {
			socket.destroy();
			resolve(connected);
		};
		socket.setTimeout(timeoutMs, () => finish(false));
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

export function watchFxConnection({ origin, onUnavailable, intervalMs = 10_000, failuresBeforeRestart = 3, probe = checkFxConnection }) {
	let stopped = false;
	let failures = 0;
	let timer;
	async function tick() {
		let connected = false;
		try { connected = await probe(origin); }
		catch {
			// Treat a failed local probe as unavailable.
		}
		if (stopped) return;
		failures = connected ? 0 : failures + 1;
		if (failures >= failuresBeforeRestart) {
			stopped = true;
			onUnavailable();
			return;
		}
		timer = setTimeout(tick, intervalMs);
		timer.unref();
	}
	// Allow the worker time to finish startup; never contact X or request post content.
	timer = setTimeout(tick, intervalMs);
	timer.unref();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}
