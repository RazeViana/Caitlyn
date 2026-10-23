/**
 * @file watchdog.mjs
 * @description Detects an unresponsive local public preview worker, including a worker lost to OOM.
 * Probes only readiness and requests one container restart after consecutive failures.
 *
 * @module publicFxWatchdog
 */

export async function checkPublicRuntime({ fetcher = fetch, timeoutMs = 4_000 } = {}) {
	try {
		const response = await fetcher("http://127.0.0.1:8787/healthz", {
			signal: AbortSignal.timeout(timeoutMs), redirect: "error",
		});
		if (!response.ok) {
			await response.body?.cancel();
			return false;
		}
		const health = await response.json();
		return health.service === "caitlyn-fxembed-public" && health.ready === true;
	}
	catch { return false; }
}

export function watchPublicRuntime({ onUnavailable, probe = checkPublicRuntime, startupDelayMs = 60_000, intervalMs = 15_000, failuresBeforeRestart = 3 }) {
	let stopped = false;
	let failures = 0;
	let timer;
	async function tick() {
		let ready = false;
		try { ready = await probe(); }
		catch {
			// A failed readiness probe counts toward recovery, without logging response content.
		}
		if (stopped) return;
		failures = ready ? 0 : failures + 1;
		if (failures >= failuresBeforeRestart) {
			stopped = true;
			onUnavailable();
			return;
		}
		timer = setTimeout(tick, intervalMs);
		timer.unref();
	}
	// Wrangler can keep running after a child worker dies. TCP acceptance alone
	// does not prove readiness, and Docker does not restart merely unhealthy containers.
	timer = setTimeout(tick, startupDelayMs);
	timer.unref();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}
