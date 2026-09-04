import { GatewayIntentBits } from "discord.js";
import { createClient } from "./core/createClient.js";
import { createPGPool } from "./core/createPGPool.js";
import { loginClient } from "./core/loginClient.js";
import { commandHandler } from "./handlers/commandHandler.js";
import { eventHandler } from "./handlers/eventHandler.js";
import { startCronJobs } from "./handlers/cronJobHandler.js";

// Create a new client instance
const client = createClient([
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.MessageContent,
	GatewayIntentBits.GuildMembers,
]);

// Create a PostgreSQL connection pool
createPGPool();

// Load the command & event handler
commandHandler(client);
eventHandler(client);

// Start the cron job handler scheduled event
startCronJobs(client);

// Log in the client
loginClient(client);
