/**
 * @file logger.ts
 * @description Writes colored console logs and publishes all levels to independently filtered subscribers.
 * Preserves console LOG_LEVEL behavior, timestamps, and asynchronous server context.
 *
 * @module logger
 */

import "dotenv/config";
import { currentLogGuild } from "./logContext.js";
import type { LogType } from "./logLevels.js";

export interface LogRecord {
	timestamp: string;
	level: LogType;
	message: string;
	guildId?: string;
}

const subscribers = new Set<(record: LogRecord) => void>();

export function subscribeLogs(subscriber: (record: LogRecord) => void): () => void {
	subscribers.add(subscriber);
	return () => { subscribers.delete(subscriber); };
}

// ANSI color codes for terminal output
const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	// Foreground colors
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	gray: "\x1b[90m",
};

// Log levels
const LOG_LEVELS = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3,
} as const;

// Current log level (can be changed via environment variable)
const configuredLevel = process.env.LOG_LEVEL?.toUpperCase() as keyof typeof LOG_LEVELS | undefined;
const currentLevel = configuredLevel === undefined
	? LOG_LEVELS.INFO
	: LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.INFO;

/**
 * Get timestamp in readable format
 * @returns {string} Formatted timestamp
 */
function getTimestamp(): string {
	const now = new Date();
	return now.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Publish a record and conditionally write the matching colored console line
 * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param {string} color - ANSI color code
 * @param {string} message - Log message
 * @param {boolean} consoleEnabled - Whether LOG_LEVEL allows console output
 */
function emit(level: LogType, color: string, message: string, consoleEnabled: boolean): void {
	const time = getTimestamp();
	const record = { timestamp: time, level, message, guildId: currentLogGuild() };
	for (const subscriber of subscribers) {
		try {
			subscriber(record);
		}
		catch {
			// A failed transport must never interrupt console logging.
		}
	}
	if (consoleEnabled) {
		const timestamp = `${colors.gray}${time}${colors.reset}`;
		const levelTag = `${color}${colors.bright}[${level}]${colors.reset}`;
		const line = `${timestamp} ${levelTag} ${message}`;
		if (level === "ERROR") console.error(line);
		else if (level === "WARN") console.warn(line);
		else console.log(line);
	}
}

/**
 * Log debug message (only in development)
 * @param {...any} args - Arguments to log
 */
function debug(...args: unknown[]): void {
	emit("DEBUG", colors.magenta, args.join(" "), currentLevel <= LOG_LEVELS.DEBUG);
}

/**
 * Log info message
 * @param {...any} args - Arguments to log
 */
function info(...args: unknown[]): void {
	emit("INFO", colors.cyan, args.join(" "), currentLevel <= LOG_LEVELS.INFO);
}

/**
 * Log warning message
 * @param {...any} args - Arguments to log
 */
function warn(...args: unknown[]): void {
	emit("WARN", colors.yellow, args.join(" "), currentLevel <= LOG_LEVELS.WARN);
}

/**
 * Log error message
 * @param {...any} args - Arguments to log
 */
function error(...args: unknown[]): void {
	const message = args.map((arg) => {
		if (arg instanceof Error) return arg.stack || arg.message;
		return String(arg);
	}).join(" ");
	emit("ERROR", colors.red, message, currentLevel <= LOG_LEVELS.ERROR);
}

/**
 * Log success message (special case of info)
 * @param {...any} args - Arguments to log
 */
function success(...args: unknown[]): void {
	emit("SUCCESS", colors.green, args.join(" "), currentLevel <= LOG_LEVELS.INFO);
}

// Export logger functions
export default {
	debug,
	info,
	warn,
	error,
	success,
};
