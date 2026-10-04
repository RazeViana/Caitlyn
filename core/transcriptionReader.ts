/**
 * @file transcriptionReader.ts
 * @description Queries participant-visible transcript events using transaction-local identity and enforced PostgreSQL row security.
 * @module transcriptionReader
 */

import type { Pool, PoolClient, QueryResultRow } from "pg";

export interface TranscriptViewer { userId: string; guildId: string }
export interface TranscriptFilters {
	query?: string;
	from?: string;
	until?: string;
	channelId?: string;
	activityChannelId?: string;
	userId?: string;
	sessionId?: string;
	type?: string;
	cursor?: string;
	limit?: number;
}

const idPattern = /^[1-9]\d{0,19}$/;
const types = new Set(["session_started", "session_stopped", "present", "joined", "left", "transcript", "message_posted", "message_edited", "message_deleted", "transcript_corrected", "voice_activity", "gap"]);
const fields = "event_id, guild_id, channel_id, channel_name, session_id, event_type, occurred_at, ended_at, user_id, username, content, activity_channel_id, activity_channel_name, message_id, message_url, metadata";

function id(value: string): string {
	if (!idPattern.test(value)) throw new Error("Invalid Discord ID");
	return value;
}

function timestamp(value: string): string {
	if (!/T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Timestamp must include a timezone");
	return new Date(value).toISOString();
}

/** Viewer identity must come from verified Discord authentication, never a browser parameter. */
async function withViewer<T>(database: Pool, viewer: TranscriptViewer, action: (connection: PoolClient) => Promise<T>): Promise<T> {
	id(viewer.userId);
	id(viewer.guildId);
	const connection = await database.connect();
	let broken = false;
	try {
		await connection.query("BEGIN READ ONLY");
		await connection.query("SET LOCAL row_security = on");
		const result = await connection.query<{ active: boolean }>("SELECT row_security_active('discord.transcript_events'::regclass) AS active");
		if (result.rows[0]?.active !== true) throw new Error("Transcript reading requires an unprivileged role with active row security");
		await connection.query("SELECT set_config('caitlyn.viewer_user_id', $1, true), set_config('caitlyn.viewer_guild_id', $2, true)", [viewer.userId, viewer.guildId]);
		const value = await action(connection);
		await connection.query("COMMIT");
		return value;
	}
	catch (error) {
		try { await connection.query("ROLLBACK"); }
		catch { broken = true; }
		throw error;
	}
	finally { connection.release(broken); }
}

export function createTranscriptionReader(database: Pool) {
	return {
		async events(viewer: TranscriptViewer, filters: TranscriptFilters = {}) {
			const values: unknown[] = [];
			const clauses: string[] = [];
			const parameter = (value: unknown): string => "$" + values.push(value);
			const limit = filters.limit ?? 100;
			if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Page size must be 1–200");
			for (const [field, value] of [["channel_id", filters.channelId], ["activity_channel_id", filters.activityChannelId], ["user_id", filters.userId]] as const) {
				if (value !== undefined) clauses.push(field + " = " + parameter(id(value)));
			}
			if (filters.sessionId !== undefined) {
				if (!/^[a-zA-Z0-9_-]{1,128}$/.test(filters.sessionId)) throw new Error("Invalid session ID");
				clauses.push("session_id = " + parameter(filters.sessionId));
			}
			if (filters.type !== undefined) {
				if (!types.has(filters.type)) throw new Error("Invalid event type");
				clauses.push("event_type = " + parameter(filters.type));
			}
			if (filters.from !== undefined) clauses.push("occurred_at >= " + parameter(timestamp(filters.from)));
			if (filters.until !== undefined) clauses.push("occurred_at < " + parameter(timestamp(filters.until)));
			if (filters.query !== undefined && filters.query.trim()) {
				if (filters.query.length > 300 || filters.query.includes("\0")) throw new Error("Invalid search query");
				clauses.push("search_document @@ websearch_to_tsquery('english', " + parameter(filters.query) + ")");
			}
			if (filters.cursor) {
				if (filters.cursor.length > 500 || !/^[a-zA-Z0-9_-]+$/.test(filters.cursor)) throw new Error("Invalid cursor");
				const cursor = JSON.parse(Buffer.from(filters.cursor, "base64url").toString("utf8"));
				if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== "string"
					|| typeof cursor[1] !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(cursor[1])) throw new Error("Invalid cursor");
				clauses.push("(occurred_at, event_id) < (" + parameter(timestamp(cursor[0])) + ", " + parameter(cursor[1]) + ")");
			}
			const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
			const sql = "SELECT " + fields + " FROM discord.transcript_events" + where
				+ " ORDER BY occurred_at DESC, event_id DESC LIMIT " + parameter(limit + 1);
			return withViewer(database, viewer, async (connection) => {
				const result = await connection.query<QueryResultRow & { event_id: string; occurred_at: Date }>(sql, values);
				const rows = result.rows.slice(0, limit);
				const last = rows.at(-1);
				const cursor = result.rows.length > limit && last
					? Buffer.from(JSON.stringify([last.occurred_at.toISOString(), last.event_id])).toString("base64url") : null;
				return { events: rows, cursor };
			});
		},

		/** Menus are built exclusively from visible rows, so names and session existence cannot leak. */
		async filters(viewer: TranscriptViewer) {
			return withViewer(database, viewer, async (connection) => {
				const users = await connection.query("SELECT DISTINCT ON (user_id) user_id, username FROM discord.transcript_events WHERE user_id IS NOT NULL ORDER BY user_id, occurred_at DESC, event_id DESC");
				const channels = await connection.query("SELECT DISTINCT ON (channel_id) channel_id, channel_name FROM discord.transcript_events ORDER BY channel_id, occurred_at DESC, event_id DESC");
				const activityChannels = await connection.query("SELECT DISTINCT ON (activity_channel_id) activity_channel_id, activity_channel_name FROM discord.transcript_events WHERE activity_channel_id IS NOT NULL ORDER BY activity_channel_id, occurred_at DESC, event_id DESC");
				return { users: users.rows, channels: channels.rows, activityChannels: activityChannels.rows };
			});
		},
	};
}
