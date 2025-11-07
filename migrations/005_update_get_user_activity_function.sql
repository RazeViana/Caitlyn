-- Update get_user_activity function to not return server_leave_count

DROP FUNCTION IF EXISTS discord.get_user_activity;

CREATE OR REPLACE FUNCTION discord.get_user_activity(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255)
)
RETURNS TABLE (
    user_id VARCHAR(255),
    username VARCHAR(255),
    message_count BIGINT,
    voice_join_count BIGINT,
    total_voice_time BIGINT,
    first_seen_at TIMESTAMP WITH TIME ZONE,
    last_seen_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ua.user_id,
        ua.username,
        ua.message_count,
        ua.voice_join_count,
        ua.total_voice_time,
        ua.first_seen_at,
        ua.last_seen_at
    FROM discord.user_activity ua
    WHERE ua.guild_id = p_guild_id
        AND ua.user_id = p_user_id;
END;
$$;
