/**
 * @file aiState.js
 * @description Manages the AI enabled/disabled state at runtime.
 * This allows toggling AI without modifying the .env file.
 *
 * @module aiState
 */

// Runtime state override (null means use .env value)
let aiEnabledOverride = null;

/**
 * Check if AI is currently enabled
 * @returns {boolean} - True if AI is enabled
 */
function isAIEnabled() {
	if (aiEnabledOverride !== null) {
		return aiEnabledOverride;
	}
	return process.env.LLM_ENABLED === "true";
}

/**
 * Enable AI
 */
function enableAI() {
	aiEnabledOverride = true;
}

/**
 * Disable AI
 */
function disableAI() {
	aiEnabledOverride = false;
}

/**
 * Toggle AI on/off
 * @returns {boolean} - New AI enabled state
 */
function toggleAI() {
	const currentState = isAIEnabled();
	aiEnabledOverride = !currentState;
	return aiEnabledOverride;
}

/**
 * Reset to .env default
 */
function resetAIState() {
	aiEnabledOverride = null;
}

export { isAIEnabled, enableAI, disableAI, toggleAI, resetAIState };
