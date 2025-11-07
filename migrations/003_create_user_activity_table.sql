-- Create user activity tracking tables

-- Main activity stats table
CREATE TABLE IF NOT EXISTS discord.user_activity (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,

    -- Activity counters
    message_count BIGINT DEFAULT 0,
    voice_join_count BIGINT DEFAULT 0,

    -- Time tracking (in seconds)
    total_voice_time BIGINT DEFAULT 0,

    -- Timestamps
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint per user per guild
    UNIQUE(guild_id, user_id)
);

-- Voice session tracking table (for active sessions)
CREATE TABLE IF NOT EXISTS discord.voice_sessions (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    channel_id VARCHAR(255) NOT NULL,
    channel_name VARCHAR(255),

    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    left_at TIMESTAMP WITH TIME ZONE,
    duration_seconds BIGINT
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_user_activity_guild ON discord.user_activity (guild_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_user ON discord.user_activity (user_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON discord.voice_sessions (user_id, guild_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions ON discord.voice_sessions (user_id, guild_id, left_at);

-- Function to increment message count
CREATE OR REPLACE FUNCTION discord.increment_message_count(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255),
    p_username VARCHAR(255)
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO discord.user_activity (guild_id, user_id, username, message_count, last_seen_at, updated_at)
    VALUES (p_guild_id, p_user_id, p_username, 1, NOW(), NOW())
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
        message_count = discord.user_activity.message_count + 1,
        username = p_username,
        last_seen_at = NOW(),
        updated_at = NOW();
END;
$$;

-- Function to increment voice join count
CREATE OR REPLACE FUNCTION discord.increment_voice_join_count(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255),
    p_username VARCHAR(255)
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO discord.user_activity (guild_id, user_id, username, voice_join_count, last_seen_at, updated_at)
    VALUES (p_guild_id, p_user_id, p_username, 1, NOW(), NOW())
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
        voice_join_count = discord.user_activity.voice_join_count + 1,
        username = p_username,
        last_seen_at = NOW(),
        updated_at = NOW();
END;
$$;

-- Function to add voice time
CREATE OR REPLACE FUNCTION discord.add_voice_time(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255),
    p_username VARCHAR(255),
    p_duration_seconds BIGINT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO discord.user_activity (guild_id, user_id, username, total_voice_time, last_seen_at, updated_at)
    VALUES (p_guild_id, p_user_id, p_username, p_duration_seconds, NOW(), NOW())
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
        total_voice_time = discord.user_activity.total_voice_time + p_duration_seconds,
        username = p_username,
        last_seen_at = NOW(),
        updated_at = NOW();
END;
$$;

-- Function to get user activity stats
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

-- Function to get top users by activity
CREATE OR REPLACE FUNCTION discord.get_top_active_users(
    p_guild_id VARCHAR(255),
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    user_id VARCHAR(255),
    username VARCHAR(255),
    message_count BIGINT,
    voice_join_count BIGINT,
    total_voice_time BIGINT,
    activity_score BIGINT
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
        (ua.message_count + ua.voice_join_count + (ua.total_voice_time / 60)) as activity_score
    FROM discord.user_activity ua
    WHERE ua.guild_id = p_guild_id
    ORDER BY activity_score DESC
    LIMIT p_limit;
END;
$$;
