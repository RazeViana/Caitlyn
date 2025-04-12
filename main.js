import { Client, GatewayIntentBits } from "discord.js";

import dotenv from "dotenv";

dotenv.config();

const TOKEN = process.env.TOKEN;

// Check if the TOKEN is set
if (!TOKEN) {
	throw new Error("No TOKEN found. Set a TOKEN environment variable");
}

// Create a new client instance
const client = new Client({
	intents: [GatewayIntentBits.Guilds],
});

client.once("ready", () => {
	console.log("Ready!");
});

client.login(TOKEN).catch((error) => {
	console.error("Error logging in:", error);
});
