export type ChatRole = "assistant" | "system" | "user";

export interface ChatMessage {
	content: string;
	role: ChatRole;
}

export interface BirthdayRow {
	discord_id: string;
	dob: Date;
	name: string;
}

export interface OllamaChatResponse {
	message: {
		content: string;
	};
}
