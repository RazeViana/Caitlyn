-- Fix daily_activity to properly track messages and voice time per day

-- Update record_daily_activity to ONLY track messages (not voice joins)
CREATE OR REPLACE FUNCTION discord.record_daily_activity(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255),
    p_username VARCHAR(255)
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_yesterday DATE := CURRENT_DATE - INTERVAL '1 day';
    v_last_activity_date DATE;
    v_current_daily_streak INT;
    v_longest_daily_streak INT;
BEGIN
    -- Insert or update today's activity record (for messages)
    INSERT INTO discord.daily_activity (guild_id, user_id, activity_date, message_count)
    VALUES (p_guild_id, p_user_id, v_today, 1)
    ON CONFLICT (guild_id, user_id, activity_date)
    DO UPDATE SET message_count = discord.daily_activity.message_count + 1;

    -- Get current streak info
    SELECT last_activity_date, daily_streak_current, daily_streak_longest
    INTO v_last_activity_date, v_current_daily_streak, v_longest_daily_streak
    FROM discord.user_activity
    WHERE guild_id = p_guild_id AND user_id = p_user_id;

    -- If no record exists or last activity was not yesterday/today, reset streak
    IF v_last_activity_date IS NULL OR v_last_activity_date < v_yesterday THEN
        v_current_daily_streak := 1;
    -- If last activity was yesterday, increment streak
    ELSIF v_last_activity_date = v_yesterday THEN
        v_current_daily_streak := COALESCE(v_current_daily_streak, 0) + 1;
    -- If last activity was today, keep current streak
    ELSIF v_last_activity_date = v_today THEN
        v_current_daily_streak := COALESCE(v_current_daily_streak, 1);
    END IF;

    -- Update longest streak if current is higher
    IF v_current_daily_streak > COALESCE(v_longest_daily_streak, 0) THEN
        v_longest_daily_streak := v_current_daily_streak;
    END IF;

    -- Update user_activity with new streak and last activity date
    INSERT INTO discord.user_activity (
        guild_id, user_id, username,
        daily_streak_current, daily_streak_longest,
        last_activity_date, last_seen_at, updated_at
    )
    VALUES (
        p_guild_id, p_user_id, p_username,
        v_current_daily_streak, v_longest_daily_streak,
        v_today, NOW(), NOW()
    )
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
        daily_streak_current = v_current_daily_streak,
        daily_streak_longest = v_longest_daily_streak,
        last_activity_date = v_today,
        last_seen_at = NOW(),
        updated_at = NOW(),
        username = p_username;
END;
$$;

-- New function to record voice time in daily_activity
CREATE OR REPLACE FUNCTION discord.record_daily_voice_time(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255),
    p_username VARCHAR(255),
    p_voice_seconds INT
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_yesterday DATE := CURRENT_DATE - INTERVAL '1 day';
    v_last_activity_date DATE;
    v_current_daily_streak INT;
    v_longest_daily_streak INT;
BEGIN
    -- Insert or update today's activity record (for voice time)
    INSERT INTO discord.daily_activity (guild_id, user_id, activity_date, voice_time_seconds)
    VALUES (p_guild_id, p_user_id, v_today, p_voice_seconds)
    ON CONFLICT (guild_id, user_id, activity_date)
    DO UPDATE SET voice_time_seconds = discord.daily_activity.voice_time_seconds + p_voice_seconds;

    -- Get current streak info
    SELECT last_activity_date, daily_streak_current, daily_streak_longest
    INTO v_last_activity_date, v_current_daily_streak, v_longest_daily_streak
    FROM discord.user_activity
    WHERE guild_id = p_guild_id AND user_id = p_user_id;

    -- If no record exists or last activity was not yesterday/today, reset streak
    IF v_last_activity_date IS NULL OR v_last_activity_date < v_yesterday THEN
        v_current_daily_streak := 1;
    -- If last activity was yesterday, increment streak
    ELSIF v_last_activity_date = v_yesterday THEN
        v_current_daily_streak := COALESCE(v_current_daily_streak, 0) + 1;
    -- If last activity was today, keep current streak
    ELSIF v_last_activity_date = v_today THEN
        v_current_daily_streak := COALESCE(v_current_daily_streak, 1);
    END IF;

    -- Update longest streak if current is higher
    IF v_current_daily_streak > COALESCE(v_longest_daily_streak, 0) THEN
        v_longest_daily_streak := v_current_daily_streak;
    END IF;

    -- Update user_activity with new streak and last activity date
    INSERT INTO discord.user_activity (
        guild_id, user_id, username,
        daily_streak_current, daily_streak_longest,
        last_activity_date, last_seen_at, updated_at
    )
    VALUES (
        p_guild_id, p_user_id, p_username,
        v_current_daily_streak, v_longest_daily_streak,
        v_today, NOW(), NOW()
    )
    ON CONFLICT (guild_id, user_id)
    DO UPDATE SET
        daily_streak_current = v_current_daily_streak,
        daily_streak_longest = v_longest_daily_streak,
        last_activity_date = v_today,
        last_seen_at = NOW(),
        updated_at = NOW(),
        username = p_username;
END;
$$;
