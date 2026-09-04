import type { Client } from "discord.js";

function loginClient(client: Client): void {
	client.login(process.env.TOKEN).catch((error: unknown) => {
		console.error("Error logging in:", error);
	});
}

export { loginClient };
