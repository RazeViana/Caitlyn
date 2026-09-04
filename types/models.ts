export interface ChatMessage {
	role: "assistant" | "system" | "user";
	content: string;
}

export interface OpenWebUIResponse {
	choices?: Array<{
		message?: {
			content: string;
		};
	}>;
}

export interface EmbeddingResponse {
	embedding?: number[];
}

export interface StoredMessage {
	id: number;
	channel_id?: string;
	message_id?: string;
	user_id?: string;
	username: string;
	role: "assistant" | "user";
	content: string;
	embedding?: number[] | string | null;
	similarity?: number;
	created_at: Date;
}

export interface MessageContext extends StoredMessage {
	source: "recent" | "similar";
}

export interface VoiceSession {
	sessionId: number;
	joinedAt: number;
	channelId: string;
}

export interface ActivityRow {
	user_id: string;
	username: string;
	message_count?: number | string;
	voice_join_count?: number | string;
	total_voice_time?: number | string;
	activity_score?: number | string;
	daily_streak_current?: number;
	daily_streak_longest?: number;
	weekly_streak_current?: number;
	weekly_streak_longest?: number;
	monthly_streak_current?: number;
	monthly_streak_longest?: number;
	first_seen_at?: Date;
	last_seen_at?: Date;
	last_activity_date?: Date;
}
