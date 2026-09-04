/**
 * @file aiState.ts
 * @description Manages the AI enabled/disabled state at runtime.
 * This allows toggling AI without modifying the .env file.
 *
 * @module aiState
 */

import "dotenv/config";

// Runtime state override (null means use .env value)
let aiEnabledOverride: boolean | null = null;

/**
 * Check if AI is currently enabled
 * @returns {boolean} - True if AI is enabled
 */
function isAIEnabled(): boolean {
	if (aiEnabledOverride !== null) {
		return aiEnabledOverride;
	}
	return process.env.LLM_ENABLED === "true";
}

/**
 * Enable AI
 */
function enableAI(): boolean {
	aiEnabledOverride = true;
	return aiEnabledOverride;
}

/**
 * Disable AI
 */
function disableAI(): boolean {
	aiEnabledOverride = false;
	return aiEnabledOverride;
}

/**
 * Toggle AI on/off
 * @returns {boolean} - New AI enabled state
 */
function toggleAI(): boolean {
	const currentState = isAIEnabled();
	aiEnabledOverride = !currentState;
	return aiEnabledOverride;
}

/**
 * Reset to .env default
 */
function resetAIState(): void {
	aiEnabledOverride = null;
}

export { isAIEnabled, enableAI, disableAI, toggleAI, resetAIState };
