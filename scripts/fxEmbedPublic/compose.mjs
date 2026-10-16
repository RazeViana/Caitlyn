/**
 * @file compose.mjs
 * @description Builds the isolated TrueNAS app definition for a pinned public FxEmbed instance.
 * Publishes only its preview port, with no secret mounts, database, GPU or Docker socket.
 *
 * @module publicFxCompose
 */

import { isIP } from "node:net";

export function publicFxCompose({ image, address, port }) {
	if (!/^sha256:[a-f0-9]{64}$/.test(image) || isIP(address) !== 4 || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("invalid_public_fx_configuration");
	return { services: { fxembed: {
		image, pull_policy: "never", restart: "unless-stopped", user: "1000:1000", init: true,
		read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"],
		cpus: 1, mem_limit: "1g", memswap_limit: "1g", pids_limit: 128, stop_grace_period: "30s",
		ports: [`${address}:${port}:8787`],
		tmpfs: ["/tmp:size=128m,nosuid", "/app/.wrangler:size=96m,uid=1000,gid=1000,mode=700,nosuid"],
		logging: { driver: "local", options: { "max-size": "10m", "max-file": "3" } },
		healthcheck: { test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8787/healthz',{signal:AbortSignal.timeout(4000)}).then(async r=>{if(!r.ok||(await r.json()).ready!==true)process.exit(1)}).catch(()=>process.exit(1))"], interval: "30s", timeout: "5s", retries: 3, start_period: "60s" },
	} } };
}
