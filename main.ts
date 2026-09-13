/**
 * @file main.ts
 * @description Coordinates validated bot startup, service readiness, and bounded shutdown.
 * Keeps imports inert and drains accepted work and log forwarding before closing services.
 *
 * @module main
 */

import "./core/loadEnvironment.js";

import { pathToFileURL } from "node:url";
import { GatewayIntentBits, type Client } from "discord.js";
import { createClient } from "./core/createClient.js";
import { createPGPool, pool } from "./core/createPGPool.js";
import { withTimeout } from "./core/asyncTools.js";
import { getFeatureConfiguration, logFeatureConfiguration, validateEnvironment } from "./core/environment.js";
import { loginClient } from "./core/loginClient.js";
import logger from "./core/logger.js";
import { createDiscordLogForwarder, logForwarders, type DiscordLogForwarder } from "./core/discordLogForwarder.js";
import { commandHandler } from "./handlers/commandHandler.js";
import { startCronJobs } from "./handlers/cronJobHandler.js";
import { drainEvents, eventHandler } from "./handlers/eventHandler.js";
import { configuredSocialRuntime, socialRuntimes, type SocialRuntime } from "./core/socialRuntime.js";

interface StartBotLogger {
	error: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
}

export interface StartBotDependencies {
	configuration?: typeof getFeatureConfiguration;
	createSocialRuntime?: (client: Client) => SocialRuntime | undefined;
	createLogForwarder?: (client: Client) => DiscordLogForwarder | undefined;
	reportConfiguration?: () => void;
	closeDatabase: () => Promise<void>;
	commandHandler: (client: Client) => Promise<void>;
	createClient: (intents: GatewayIntentBits[]) => Client;
	createPGPool: () => Promise<void>;
	eventHandler: (client: Client) => Promise<void>;
	drainEvents: (client: Client) => Promise<void>;
	loginClient: (client: Client) => Promise<void>;
	logger: StartBotLogger;
	startCronJobs: (client: Client) => () => Promise<void>;
	validateEnvironment: () => void;
}

const defaultDependencies: StartBotDependencies = {
	createSocialRuntime: configuredSocialRuntime,
	configuration: getFeatureConfiguration,
	createLogForwarder: createDiscordLogForwarder,
	reportConfiguration: () => logFeatureConfiguration(logger),
	closeDatabase: () => pool.end(),
	commandHandler,
	createClient,
	createPGPool,
	eventHandler,
	drainEvents,
	loginClient,
	logger,
	startCronJobs,
	validateEnvironment,
};

export async function startBot(
	dependencies: StartBotDependencies = defaultDependencies,
): Promise<{ stop: () => Promise<void> }> {
	let client: Client | undefined;
	let closeJobs: (() => Promise<void>) | undefined;
	let stopping: Promise<void> | undefined;
	let logForwarder: DiscordLogForwarder | undefined;
	let socialRuntime: SocialRuntime | undefined;
	let databaseEnabled = true;
	const stop = (): Promise<void> => {
		stopping ??= (async () => {
			if (!client) return;
			const cleanup = async (label: string, action: () => Promise<unknown>): Promise<void> => {
				try {
					await withTimeout(action(), 10_000, label);
				}
				catch (error) {
					dependencies.logger.error(`Failed during ${label}:`, error);
				}
			};
			await cleanup("work drain", async () => {
				const outcomes = await Promise.allSettled([
					dependencies.drainEvents(client!),
					closeJobs?.(),
					socialRuntime?.stop(),
				]);
				const failures = outcomes.filter((outcome) => outcome.status === "rejected");
				if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason), "Work drain failed");
			});
			await cleanup("log forwarding shutdown", async () => { await logForwarder?.stop(); });
			logForwarders.delete(client);
			socialRuntimes.delete(client);
			await cleanup("Discord shutdown", () => client!.destroy());
			if (databaseEnabled) await cleanup("database shutdown", dependencies.closeDatabase);
		})();
		return stopping;
	};
	try {
		dependencies.validateEnvironment();
		const configuration = dependencies.configuration?.();
		databaseEnabled = configuration?.database.enabled !== false;
		dependencies.logger.info("Starting Caitlyn bot...", `pid=${process.pid}`);

		// Create a new client instance
		client = dependencies.createClient([
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildVoiceStates,
		]);
		if (configuration?.discordLogging.enabled !== false) logForwarder = dependencies.createLogForwarder?.(client);
		if (logForwarder) logForwarders.set(client, logForwarder);
		dependencies.reportConfiguration?.();
		if (configuration?.socialMedia.enabled !== false) socialRuntime = dependencies.createSocialRuntime?.(client);
		if (socialRuntime) socialRuntimes.set(client, socialRuntime);

		// Create a PostgreSQL connection pool
		if (databaseEnabled) await dependencies.createPGPool();
		await logForwarder?.start();

		// Load the command & event handler
		await dependencies.commandHandler(client);
		await dependencies.eventHandler(client);

		// Log in the client
		dependencies.logger.info("Logging in to Discord...");
		await dependencies.loginClient(client);
		socialRuntime?.start();

		dependencies.logger.info("Starting cron jobs...");
		if (configuration?.birthdayReminders.enabled !== false) closeJobs = dependencies.startCronJobs(client);
		dependencies.logger.info("Bot started successfully");
		return { stop };
	}
	catch (error) {
		dependencies.logger.error("Failed to start bot:", error);
		await stop();
		throw error;
	}
}

function registerProcessHandlers(shutdown: (code: number) => void): void {
	// Handle uncaught exceptions
	process.on("uncaughtException", (error) => {
		logger.error("Uncaught Exception:", error);
		shutdown(1);
	});

	process.on("unhandledRejection", (reason, promise) => {
		logger.error("Unhandled Rejection at:", promise, "reason:", reason);
		shutdown(1);
	});

	// Handle graceful shutdown
	process.on("SIGTERM", () => {
		logger.info("SIGTERM signal received. Shutting down gracefully...");
		shutdown(0);
	});

	process.on("SIGINT", () => {
		logger.info("SIGINT signal received. Shutting down gracefully...");
		shutdown(0);
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const startup = startBot();
	let stopping = false;
	registerProcessHandlers((code) => {
		if (stopping) return;
		stopping = true;
		void withTimeout(startup.then((runtime) => runtime.stop()), 15_000, "Shutdown")
			.catch((error: unknown) => logger.error("Shutdown failed:", error))
			.finally(() => process.exit(code));
	});
	void startup.catch(() => { process.exitCode = 1; });
}
