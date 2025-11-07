import "dotenv/config";

import { GatewayIntentBits } from "discord.js";
import { commandHandler } from "./handlers/commandHandler.js";
import { eventHandler } from "./handlers/eventHandler.js";
import { createClient } from "./core/createClient.js";
import { loginClient } from "./core/loginClient.js";
import { createPGPool } from "./core/createPGPool.js";
import { startCronJobs } from "./handlers/cronJobHandler.js";
import logger from "./core/logger.js";

async function startBot() {
  try {
    logger.info("Starting Caitlyn bot...");

    // Create a new client instance
    const client = createClient([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ]);

    // Create a PostgreSQL connection pool
    await createPGPool();

    // Load the command & event handler
    await commandHandler(client);
    await eventHandler(client);

    // Start the cron job handler scheduled event
    logger.info("Starting cron jobs...");
    startCronJobs(client);

    // Log in the client
    logger.info("Logging in to Discord...");
    loginClient(client);
    logger.info("Bot started successfully");
  } catch (error) {
    logger.error("Failed to start bot:", error);
    process.exit(1);
  }
}

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

startBot();
