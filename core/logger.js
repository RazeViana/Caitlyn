/**
 * @file logger.js
 * @description Simple, colorful logging utility for the Caitlyn Discord bot
 * @module logger
 */

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
};

// Current log level (can be changed via environment variable)
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LOG_LEVELS.INFO;

/**
 * Get timestamp in readable format
 * @returns {string} Formatted timestamp
 */
function getTimestamp() {
	const now = new Date();
	return now.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * Format log message with color and timestamp
 * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param {string} color - ANSI color code
 * @param {string} message - Log message
 * @returns {string} Formatted log message
 */
function formatMessage(level, color, message) {
	const timestamp = `${colors.gray}${getTimestamp()}${colors.reset}`;
	const levelTag = `${color}${colors.bright}[${level}]${colors.reset}`;
	return `${timestamp} ${levelTag} ${message}`;
}

/**
 * Log debug message (only in development)
 * @param {...any} args - Arguments to log
 */
function debug(...args) {
	if (currentLevel <= LOG_LEVELS.DEBUG) {
		console.log(formatMessage("DEBUG", colors.magenta, args.join(" ")));
	}
}

/**
 * Log info message
 * @param {...any} args - Arguments to log
 */
function info(...args) {
	if (currentLevel <= LOG_LEVELS.INFO) {
		console.log(formatMessage("INFO", colors.cyan, args.join(" ")));
	}
}

/**
 * Log warning message
 * @param {...any} args - Arguments to log
 */
function warn(...args) {
	if (currentLevel <= LOG_LEVELS.WARN) {
		console.warn(formatMessage("WARN", colors.yellow, args.join(" ")));
	}
}

/**
 * Log error message
 * @param {...any} args - Arguments to log
 */
function error(...args) {
	if (currentLevel <= LOG_LEVELS.ERROR) {
		const message = args.map(arg => {
			if (arg instanceof Error) {
				return arg.stack || arg.message;
			}
			return String(arg);
		}).join(" ");
		console.error(formatMessage("ERROR", colors.red, message));
	}
}

/**
 * Log success message (special case of info)
 * @param {...any} args - Arguments to log
 */
function success(...args) {
	if (currentLevel <= LOG_LEVELS.INFO) {
		console.log(formatMessage("SUCCESS", colors.green, args.join(" ")));
	}
}

// Export logger functions
export default {
	debug,
	info,
	warn,
	error,
	success,
};
