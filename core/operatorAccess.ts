/**
 * @file operatorAccess.ts
 * @description Verifies Discord application ownership for private logging controls.
 * Uses live application metadata with a bounded lookup instead of hard-coded owner IDs.
 *
 * @module operatorAccess
 */

import type { Client } from "discord.js";
import { withTimeout } from "./asyncTools.js";

export async function isBotOperator(client: Client, userId: string): Promise<boolean> {
	if (!client.application) return false;
	const application = await withTimeout(client.application.fetch(), 8000, "Application owner lookup");
	const owner = application.owner;
	return Boolean(owner && ("ownerId" in owner ? owner.ownerId : owner.id) === userId);
}
