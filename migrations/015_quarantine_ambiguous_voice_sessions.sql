-- @file 015_quarantine_ambiguous_voice_sessions.sql
-- @description Preserves ambiguous legacy voice history without crediting guessed durations.
-- Separates those records from future tracking and prevents duplicate active sessions.
-- @module quarantineAmbiguousVoiceSessions

ALTER TABLE discord.voice_sessions
    ADD COLUMN IF NOT EXISTS needs_reconciliation BOOLEAN NOT NULL DEFAULT FALSE;

-- Keep every original timestamp/duration and activity total unchanged for later review.
UPDATE discord.voice_sessions s SET needs_reconciliation = TRUE
WHERE s.left_at IS NULL AND NOT s.needs_reconciliation AND (
    s.joined_at IS NULL OR EXISTS (
        SELECT 1 FROM discord.voice_sessions other
        WHERE other.guild_id = s.guild_id AND other.user_id = s.user_id
          AND other.left_at IS NULL AND NOT other.needs_reconciliation AND other.id <> s.id
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_sessions_one_tracked_open
    ON discord.voice_sessions (guild_id, user_id)
    WHERE left_at IS NULL AND NOT needs_reconciliation;
