-- @file 019_transcript_message_access.sql
-- @description Separates Discord text-channel access from immutable voice attendance without granting readers access to permission lists.
-- @module transcriptMessageAccessMigration

CREATE TABLE IF NOT EXISTS discord.transcript_channel_access (
    guild_id TEXT NOT NULL CHECK (guild_id ~ '^[1-9][0-9]*$'),
    channel_id TEXT NOT NULL CHECK (channel_id ~ '^[1-9][0-9]*$'),
    user_ids TEXT[] NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (guild_id, channel_id)
);
REVOKE ALL ON discord.transcript_channel_access FROM PUBLIC;

-- Only a yes/no answer about the transaction's authenticated viewer is exposed.
-- The bot owns and refreshes the private permission snapshots. Missing or stale
-- snapshots deny access, including after a database backup is restored.
CREATE OR REPLACE FUNCTION discord.can_read_transcript_message(server_id TEXT, source_channel_id TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM discord.transcript_channel_access access
        WHERE access.guild_id = server_id
          AND access.channel_id = source_channel_id
          AND access.guild_id = nullif(current_setting('caitlyn.viewer_guild_id', true), '')
          AND access.valid_until > statement_timestamp()
          AND access.user_ids @> ARRAY[nullif(current_setting('caitlyn.viewer_user_id', true), '')]::TEXT[]
    );
$$;

DROP POLICY IF EXISTS transcript_participant_read ON discord.transcript_events;
CREATE POLICY transcript_participant_read ON discord.transcript_events
    FOR SELECT TO PUBLIC
    USING (
        guild_id = nullif(current_setting('caitlyn.viewer_guild_id', true), '')
        AND CASE WHEN event_type IN ('message_posted', 'message_edited', 'message_deleted')
            THEN message_id IS NOT NULL
                AND discord.can_read_transcript_message(guild_id, activity_channel_id)
            ELSE audience_version = 1
                AND audience_user_ids @> ARRAY[nullif(current_setting('caitlyn.viewer_user_id', true), '')]::TEXT[]
        END
    );

-- Publicly readable chat rows must not disclose a separate private voice room or
-- voice-session identity. Raw append-only files and event IDs remain unchanged.
UPDATE discord.transcript_events
SET channel_id = activity_channel_id,
    channel_name = coalesce(activity_channel_name, 'Unknown channel'),
    session_id = 'messages-' || activity_channel_id
WHERE event_type IN ('message_posted', 'message_edited', 'message_deleted')
  AND activity_channel_id IS NOT NULL;
