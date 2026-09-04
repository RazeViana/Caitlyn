import {
	Client,
	type GatewayIntentBits,
} from "discord.js";

function createClient(intents: GatewayIntentBits[]): Client {
	const client = new Client({ intents });

	if (!client) {
		throw new Error("Client is not defined");
	}

	console.log("[INFO] Created discord client instance");
	return client;
}

export { createClient };
