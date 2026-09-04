declare namespace NodeJS {
	interface ProcessEnv {
		CLIENT_ID: string;
		CONVERSATION_MEMORY_SIZE: string;
		GENERAL_CHAT_ID: string;
		GIPHY_API_KEY: string;
		GUILD_ID: string;
		LLM_ENABLED?: "true" | "false";
		OLLAMA_CHAT_ENDPOINT: string;
		OLLAMA_MODEL: string;
		SYSTEM_PROMPT: string;
		TOKEN: string;
	}
}
