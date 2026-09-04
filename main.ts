import "dotenv/config";

import { pathToFileURL } from "node:url";
import { GatewayIntentBits, type Client } from "discord.js";
import { createClient } from "./core/createClient.js";
import { createPGPool } from "./core/createPGPool.js";
import { loginClient } from "./core/loginClient.js";
import logger from "./core/logger.js";
import { commandHandler } from "./handlers/commandHandler.js";
import { startCronJobs } from "./handlers/cronJobHandler.js";
import { eventHandler } from "./handlers/eventHandler.js";

interface StartBotLogger {
	error: (...args: unknown[]) => void;
	info: (...args: unknown[]) => void;
}

export interface StartBotDependencies {
	commandHandler: (client: Client) => Promise<void>;
	createClient: (intents: GatewayIntentBits[]) => Client;
	createPGPool: () => Promise<void>;
	eventHandler: (client: Client) => Promise<void>;
	loginClient: (client: Client) => void;
	logger: StartBotLogger;
	startCronJobs: (client: Client) => void;
}

const defaultDependencies: StartBotDependencies = {
	commandHandler,
	createClient,
	createPGPool,
	eventHandler,
	loginClient,
	logger,
	startCronJobs,
};

export async function startBot(
	dependencies: StartBotDependencies = defaultDependencies,
): Promise<void> {
	try {
		dependencies.logger.info("Starting Caitlyn bot...");

		// Create a new client instance
		const client = dependencies.createClient([
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildVoiceStates,
		]);

		// Create a PostgreSQL connection pool
		await dependencies.createPGPool();

		// Load the command & event handler
		await dependencies.commandHandler(client);
		await dependencies.eventHandler(client);

		// Start the cron job handler scheduled event
		dependencies.logger.info("Starting cron jobs...");
		dependencies.startCronJobs(client);

		// Log in the client
		dependencies.logger.info("Logging in to Discord...");
		dependencies.loginClient(client);
		dependencies.logger.info("Bot started successfully");
	}
	catch (error) {
		dependencies.logger.error("Failed to start bot:", error);
		process.exit(1);
	}
}

function registerProcessHandlers(): void {
	// Handle uncaught exceptions
	process.on("uncaughtException", (error) => {
		logger.error("Uncaught Exception:", error);
		process.exit(1);
	});

	process.on("unhandledRejection", (reason, promise) => {
		logger.error("Unhandled Rejection at:", promise, "reason:", reason);
		process.exit(1);
	});

	// Handle graceful shutdown
	process.on("SIGTERM", () => {
		logger.info("SIGTERM signal received. Shutting down gracefully...");
		process.exit(0);
	});

	process.on("SIGINT", () => {
		logger.info("SIGINT signal received. Shutting down gracefully...");
		process.exit(0);
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	registerProcessHandlers();
	void startBot();
}
