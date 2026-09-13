/**
 * @file socialProgress.ts
 * @description Shows expiring Discord typing feedback while a social preview is being prepared.
 * Never blocks delivery, overlaps requests, or creates a status message requiring durable cleanup.
 *
 * @module socialProgress
 */

import { withTimeout } from "./asyncTools.js";

export function startSocialProgress(dependencies: {
	typing: (signal: AbortSignal) => Promise<void>;
	unavailable: () => void;
	refreshMs?: number;
	timeoutMs?: number;
}): () => void {
	let stopped = false;
	let active = false;
	const controller = new AbortController();
	const stop = (): void => {
		stopped = true;
		clearInterval(timer);
		controller.abort();
	};
	const pulse = async (): Promise<void> => {
		if (stopped || active) return;
		active = true;
		try { await withTimeout(dependencies.typing(controller.signal), dependencies.timeoutMs ?? 5_000, "social_typing"); }
		catch {
			if (!stopped) dependencies.unavailable();
			stop();
		}
		finally { active = false; }
	};
	// Discord expires typing automatically after ten seconds; refresh only during active work.
	const timer = setInterval(() => { void pulse(); }, dependencies.refreshMs ?? 8_000);
	timer.unref();
	void pulse();
	return stop;
}
