/**
 * @file environment.d.ts
 * @description Declares the bot's required and optional process environment variables.
 * Runtime configuration checks remain in core/environment.ts.
 *
 * @module environment.d
 */

declare namespace NodeJS {
	interface ProcessEnv {
		BIRTHDAY_TIMEZONE?: string;
		CLIENT_ID: string;
		CONTEXT_RECENT_COUNT?: string;
		CONTEXT_SIMILAR_COUNT?: string;
		EMBEDDING_ENDPOINT: string;
		EMBEDDING_MODEL: string;
		GENERAL_CHAT_ID: string;
		GIPHY_API_KEY: string;
		GUILD_ID: string;
		LLM_ENABLED?: "true" | "false";
		LOG_LEVEL?: "DEBUG" | "INFO" | "WARN" | "ERROR";
		OLLAMA_MODEL: string;
		PGDATABASE: string;
		PGHOST: string;
		PGPASSWORD: string;
		PGPORT: string;
		PGUSER: string;
		TOKEN: string;
		WEBUI_API_KEY: string;
		WEBUI_CHAT_ENDPOINT: string;
	}
}
