const { GatewayIntentBits } = require("discord.js");
const { commandHandler } = require("./handlers/commandHandler.js");
const { eventHandler } = require("./handlers/eventHandler.js");
const { createClient } = require("./core/createClient.js");
const { loginClient } = require("./core/loginClient.js");

// Create a new client instance
const client = createClient([GatewayIntentBits.Guilds]);

// Load the command & event handler
commandHandler(client);
eventHandler(client);

// Log in the client
loginClient(client);
