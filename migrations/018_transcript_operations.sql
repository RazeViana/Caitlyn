-- @file 018_transcript_operations.sql
-- @description Adds append-only revision events, recovery checkpoints and durable retention fences without widening participant access.
-- @module transcriptOperationsMigration

ALTER TABLE discord.transcript_events DROP CONSTRAINT IF EXISTS transcript_events_event_type_check;
ALTER TABLE discord.transcript_events ADD CONSTRAINT transcript_events_event_type_check CHECK (event_type IN (
    'session_started', 'session_stopped', 'present', 'joined', 'left', 'transcript',
    'message_posted', 'message_edited', 'message_deleted', 'transcript_corrected', 'voice_activity', 'gap'
));
ALTER TABLE discord.transcript_import_offsets ADD COLUMN IF NOT EXISTS discarding_line BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS transcript_events_message ON discord.transcript_events (guild_id, message_id, occurred_at DESC) WHERE message_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS discord.transcript_retention (
    guild_id TEXT PRIMARY KEY,
    deleted_before TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- This private table intentionally receives no member grants. A replay of old
-- files must never resurrect content removed by an operator's retention policy.
