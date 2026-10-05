-- @file 017_transcript_archive.sql
-- @description Stores replayable transcript events with immutable capture-time audiences and row-level read restrictions.
-- @module transcriptArchiveMigration

CREATE TABLE IF NOT EXISTS discord.transcript_events (
    event_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL CHECK (guild_id ~ '^[1-9][0-9]*$'),
    channel_id TEXT NOT NULL CHECK (channel_id ~ '^[1-9][0-9]*$'),
    channel_name TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'session_started', 'session_stopped', 'present', 'joined', 'left',
        'transcript', 'message_posted', 'voice_activity', 'gap'
    )),
    occurred_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    user_id TEXT,
    username TEXT,
    content TEXT,
    activity_channel_id TEXT,
    activity_channel_name TEXT,
    message_id TEXT,
    message_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    audience_version SMALLINT NOT NULL DEFAULT 0 CHECK (audience_version IN (0, 1)),
    audience_user_ids TEXT[] NOT NULL DEFAULT '{}',
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    search_document TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(content, ''))
    ) STORED,
    CHECK (ended_at IS NULL OR ended_at >= occurred_at),
    CHECK (audience_version = 1 OR cardinality(audience_user_ids) = 0)
);

CREATE INDEX IF NOT EXISTS transcript_events_timeline
    ON discord.transcript_events (guild_id, occurred_at DESC, event_id DESC);
CREATE INDEX IF NOT EXISTS transcript_events_channel
    ON discord.transcript_events (guild_id, channel_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS transcript_events_user
    ON discord.transcript_events (guild_id, user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS transcript_events_session
    ON discord.transcript_events (guild_id, session_id, occurred_at);
CREATE INDEX IF NOT EXISTS transcript_events_text
    ON discord.transcript_events USING GIN (search_document);
CREATE INDEX IF NOT EXISTS transcript_events_audience
    ON discord.transcript_events USING GIN (audience_user_ids);

-- The bot/database owner can ingest and maintain the archive. An unprivileged
-- website role receives SELECT only, with both settings derived from authenticated
-- server-side identity using SET LOCAL inside a transaction. Missing settings deny.
-- There is intentionally no Discord administrator or server-owner exception.
ALTER TABLE discord.transcript_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transcript_participant_read ON discord.transcript_events;
CREATE POLICY transcript_participant_read ON discord.transcript_events
    FOR SELECT TO PUBLIC
    USING (
        audience_version = 1
        AND guild_id = nullif(current_setting('caitlyn.viewer_guild_id', true), '')
        AND audience_user_ids @> ARRAY[nullif(current_setting('caitlyn.viewer_user_id', true), '')]::TEXT[]
    );

-- Private ingestion checkpoints are never granted to a website role.
CREATE TABLE IF NOT EXISTS discord.transcript_import_offsets (
    source TEXT PRIMARY KEY,
    byte_offset BIGINT NOT NULL CHECK (byte_offset >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
