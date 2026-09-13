/**
 * @file loadEnvironment.ts
 * @description Loads normal bot configuration while excluding the FxEmbed-only account fields.
 * Keeps existing process overrides and prevents X session values from reaching child-process environments.
 *
 * @module loadEnvironment
 */

import { config } from "dotenv";

const parsed: Record<string, string> = {};
config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env", processEnv: parsed, quiet: true, debug: false });
for (const [name, value] of Object.entries(parsed)) {
	if (!name.startsWith("FXEMBED_X_") && process.env[name] === undefined) process.env[name] = value;
	delete parsed[name];
}
for (const name of Object.keys(process.env)) {
	if (name.startsWith("FXEMBED_X_")) delete process.env[name];
}
