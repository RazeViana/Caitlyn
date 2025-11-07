import "dotenv/config";

import { GatewayIntentBits } from "discord.js";
import { commandHandler } from "./handlers/commandHandler.js";
import { eventHandler } from "./handlers/eventHandler.js";
import { createClient } from "./core/createClient.js";
import { loginClient } from "./core/loginClient.js";
import { createPGPool } from "./core/createPGPool.js";
import { startCronJobs } from "./handlers/cronJobHandler.js";

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
startCronJobs(client);

// Log in the client
loginClient(client);
