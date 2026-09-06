/**
 * @file logLevels.ts
 * @description Defines and validates exact Discord log-level selections independently of console filtering.
 * Accepts warning as an alias for WARN, plus all and none shortcuts.
 *
 * @module logLevels
 */

export const LOG_TYPES = ["DEBUG", "INFO", "SUCCESS", "WARN", "ERROR"] as const;
export type LogType = typeof LOG_TYPES[number];
export const DEFAULT_LOG_TYPES: LogType[] = ["INFO", "SUCCESS", "WARN", "ERROR"];

export function validLogTypes(value: unknown): value is LogType[] {
	return Array.isArray(value) && value.length <= LOG_TYPES.length
		&& value.every((level) => LOG_TYPES.includes(level)) && new Set(value).size === value.length;
}

export function parseLogTypes(input: string): LogType[] {
	const value = input.trim().toUpperCase();
	if (value === "ALL") return [...LOG_TYPES];
	if (value === "NONE") return [];
	const levels = [...new Set(value.split(/[\s,]+/).map((level) => level === "WARNING" ? "WARN" : level))];
	if (!validLogTypes(levels)) throw new Error("Choose debug, info, success, warning, error; or use all or none.");
	return LOG_TYPES.filter((level) => levels.includes(level));
}

export function describeLogTypes(levels: readonly LogType[]): string {
	return levels.length ? levels.map((level) => level === "WARN" ? "warning" : level.toLowerCase()).join(", ") : "none (paused)";
}
