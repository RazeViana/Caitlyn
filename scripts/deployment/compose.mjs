/**
 * @file compose.mjs
 * @description Creates a pinned private production service layout without embedding credentials or server IDs.
 * Only the trusted broker receives Docker access; FxEmbed shares its loopback network with that broker.
 *
 * @module deploymentCompose
 */

export function createDeploymentCompose({ root, images, dockerGroup, activateBot = false }) {
	if (typeof root !== "string" || !/^\/mnt\/[A-Za-z0-9_./-]+$/.test(root) || root.includes("..") || root.length > 180) throw new Error("invalid_deployment_root");
	if (!images || !["bot", "broker", "fxembed", "media"].every((name) => /^sha256:[a-f0-9]{64}$/.test(images[name]))) throw new Error("deployment_requires_image_ids");
	if (!Number.isSafeInteger(dockerGroup) || dockerGroup < 0 || dockerGroup > 2_147_483_647) throw new Error("invalid_docker_group");
	if (typeof activateBot !== "boolean") throw new Error("invalid_activation_flag");
	const defaults = () => ({
		pull_policy: "never", restart: "unless-stopped", user: "1000:1000", init: true,
		read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"],
		stop_grace_period: "30s", pids_limit: 128,
		labels: { "com.centurylinklabs.watchtower.enable": "false", "dev.caitlyn.deployment": "v3" },
		logging: { driver: "local", options: { "max-size": "10m", "max-file": "3" } },
	});
	const bind = (source, target, readOnly = true) => ({ type: "bind", source: root + "/" + source, target, read_only: readOnly, bind: { create_host_path: false } });
	const health = (script) => ({ test: ["CMD", "node", script], interval: "30s", timeout: "5s", retries: 3, start_period: "60s" });
	const services = {
		fxembed: {
			...defaults(), image: images.fxembed, mem_limit: "768m", memswap_limit: "768m", cpus: 1,
			environment: { CAITLYN_FX_CONFIG_FILE: "/run/caitlyn-fx/runtime.json", CAITLYN_FX_LOOPBACK_ONLY: "true" },
			volumes: [bind("fx", "/run/caitlyn-fx")],
			tmpfs: ["/tmp:size=96m,mode=1777,nosuid", "/app/.wrangler:size=96m,uid=1000,gid=1000,mode=700,nosuid"],
			logging: { driver: "none" }, healthcheck: health("/app/healthcheck.mjs"),
		},
		broker: {
			...defaults(), image: images.broker, mem_limit: "512m", memswap_limit: "512m", cpus: 1,
			network_mode: "service:fxembed", group_add: [String(dockerGroup)],
			depends_on: { fxembed: { condition: "service_healthy" } },
			environment: { SOCIAL_WORKER_DOCKER_CONTEXT: "default", SOCIAL_WORKER_IMAGE: images.media, SOCIAL_X_PROVIDER: "fxembed",
				SOCIAL_FXEMBED_URL: "http://127.0.0.1:8787", SOCIAL_FXEMBED_KEY_FILE: "/run/caitlyn-key/fxembed.key",
				SOCIAL_WORKER_SOCKET: "/run/caitlyn-ipc/worker.sock", LOG_LEVEL: "INFO" },
			volumes: [bind("ipc", "/run/caitlyn-ipc", false), bind("key", "/run/caitlyn-key"),
				{ type: "bind", source: "/var/run/docker.sock", target: "/var/run/docker.sock", read_only: true, bind: { create_host_path: false } }],
			tmpfs: ["/tmp:size=64m,mode=1777,nosuid,noexec"], healthcheck: health("/app/scripts/deployment/brokerHealth.mjs"),
		},
	};
	if (activateBot) {
		services.caitlyn = {
			...defaults(), image: images.bot, mem_limit: "512m", memswap_limit: "512m", cpus: 1,
			depends_on: { broker: { condition: "service_healthy" } },
			environment: { DOTENV_CONFIG_PATH: "/run/caitlyn-bot/bot.env", NODE_ENV: "production", LLM_ENABLED: "false",
				SOCIAL_MEDIA_ENABLED: "true", SOCIAL_WORKER_SOCKET: "/run/caitlyn-ipc/worker.sock" },
			volumes: [bind("bot", "/run/caitlyn-bot"), bind("ipc", "/run/caitlyn-ipc")],
			tmpfs: ["/tmp:size=64m,mode=1777,nosuid,noexec"],
		};
	}
	return { services };
}
