require("dotenv").config();

const { GatewayIntentBits } = require("discord.js");
const { commandHandler } = require("./handlers/commandHandler.js");
const { eventHandler } = require("./handlers/eventHandler.js");
const { createClient } = require("./core/createClient.js");
const { loginClient } = require("./core/loginClient.js");
const { createPGPool } = require("./core/createPGPool.js");
const { startCronJobs } = require("./handlers/cronJobHandler.js");

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
