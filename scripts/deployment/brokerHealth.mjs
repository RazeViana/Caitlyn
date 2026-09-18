/**
 * @file brokerHealth.mjs
 * @description Checks the broker's private liveness socket without querying media providers or Discord.
 *
 * @module brokerHealth
 */

import { request } from "node:http";

const operation = request({ socketPath: process.env.SOCIAL_WORKER_SOCKET, path: "/v1/health", timeout: 3_000 }, (response) => {
	let body = "";
	response.on("data", (chunk) => {
		body += chunk;
		if (body.length > 2_048) operation.destroy();
	});
	response.on("end", () => {
		try {
			const health = JSON.parse(body);
			if (response.statusCode !== 200 || health.service !== "caitlyn-media" || !["idle", "busy"].includes(health.status)) throw new Error("not_ready");
		}
		catch { process.exitCode = 1; }
	});
	response.on("error", () => { process.exitCode = 1; });
});
operation.on("timeout", () => {
	operation.destroy();
	process.exitCode = 1;
});
operation.on("error", () => { process.exitCode = 1; });
operation.end();
