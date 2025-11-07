-- Add activity streak tracking

-- Add streak columns to user_activity table
ALTER TABLE discord.user_activity
    ADD COLUMN IF NOT EXISTS daily_streak_current INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS daily_streak_longest INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS weekly_streak_current INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS weekly_streak_longest INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monthly_streak_current INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monthly_streak_longest INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_activity_date DATE;

-- Table to track daily activity (for streak calculation)
CREATE TABLE IF NOT EXISTS discord.daily_activity (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    activity_date DATE NOT NULL,
    message_count INT DEFAULT 0,
    voice_time_seconds INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- One record per user per day
    UNIQUE(guild_id, user_id, activity_date)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_daily_activity_user ON discord.daily_activity (guild_id, user_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_last_date ON discord.user_activity (guild_id, user_id, last_activity_date);

-- Function to record daily activity
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
    -- Insert or update today's activity record
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

-- Function to calculate weekly streaks
CREATE OR REPLACE FUNCTION discord.calculate_weekly_streak(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255)
)
RETURNS TABLE (
    current_streak INT,
    longest_streak INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_streak INT := 0;
    v_longest_streak INT := 0;
    v_temp_streak INT := 0;
    v_week_start DATE;
    v_last_week DATE;
    v_found BOOLEAN;
BEGIN
    v_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
    v_last_week := v_week_start;

    -- Calculate current streak (consecutive weeks with activity)
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM discord.daily_activity
            WHERE guild_id = p_guild_id
            AND user_id = p_user_id
            AND activity_date >= v_last_week
            AND activity_date < v_last_week + INTERVAL '7 days'
        ) INTO v_found;

        EXIT WHEN NOT v_found;

        v_current_streak := v_current_streak + 1;
        v_last_week := v_last_week - INTERVAL '7 days';
    END LOOP;

    -- Calculate longest streak (scan all history)
    v_temp_streak := 0;
    v_longest_streak := 0;

    FOR v_last_week IN
        SELECT DISTINCT DATE_TRUNC('week', activity_date)::DATE as week_start
        FROM discord.daily_activity
        WHERE guild_id = p_guild_id AND user_id = p_user_id
        ORDER BY week_start DESC
    LOOP
        IF v_temp_streak = 0 OR v_last_week = v_week_start - (v_temp_streak * INTERVAL '7 days') THEN
            v_temp_streak := v_temp_streak + 1;
            v_week_start := v_last_week;
            IF v_temp_streak > v_longest_streak THEN
                v_longest_streak := v_temp_streak;
            END IF;
        ELSE
            v_temp_streak := 1;
            v_week_start := v_last_week;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_current_streak, GREATEST(v_longest_streak, v_current_streak);
END;
$$;

-- Function to calculate monthly streaks
CREATE OR REPLACE FUNCTION discord.calculate_monthly_streak(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255)
)
RETURNS TABLE (
    current_streak INT,
    longest_streak INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_streak INT := 0;
    v_longest_streak INT := 0;
    v_temp_streak INT := 0;
    v_month_start DATE;
    v_last_month DATE;
    v_found BOOLEAN;
BEGIN
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_last_month := v_month_start;

    -- Calculate current streak (consecutive months with activity)
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM discord.daily_activity
            WHERE guild_id = p_guild_id
            AND user_id = p_user_id
            AND activity_date >= v_last_month
            AND activity_date < (v_last_month + INTERVAL '1 month')::DATE
        ) INTO v_found;

        EXIT WHEN NOT v_found;

        v_current_streak := v_current_streak + 1;
        v_last_month := (v_last_month - INTERVAL '1 month')::DATE;
    END LOOP;

    -- Calculate longest streak
    v_temp_streak := 0;
    v_longest_streak := 0;

    FOR v_last_month IN
        SELECT DISTINCT DATE_TRUNC('month', activity_date)::DATE as month_start
        FROM discord.daily_activity
        WHERE guild_id = p_guild_id AND user_id = p_user_id
        ORDER BY month_start DESC
    LOOP
        IF v_temp_streak = 0 OR v_last_month = v_month_start - (v_temp_streak || ' months')::INTERVAL THEN
            v_temp_streak := v_temp_streak + 1;
            v_month_start := v_last_month;
            IF v_temp_streak > v_longest_streak THEN
                v_longest_streak := v_temp_streak;
            END IF;
        ELSE
            v_temp_streak := 1;
            v_month_start := v_last_month;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_current_streak, GREATEST(v_longest_streak, v_current_streak);
END;
$$;

-- Function to update all streaks for a user
CREATE OR REPLACE FUNCTION discord.update_user_streaks(
    p_guild_id VARCHAR(255),
    p_user_id VARCHAR(255)
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_weekly_current INT;
    v_weekly_longest INT;
    v_monthly_current INT;
    v_monthly_longest INT;
BEGIN
    -- Calculate weekly streaks
    SELECT * INTO v_weekly_current, v_weekly_longest
    FROM discord.calculate_weekly_streak(p_guild_id, p_user_id);

    -- Calculate monthly streaks
    SELECT * INTO v_monthly_current, v_monthly_longest
    FROM discord.calculate_monthly_streak(p_guild_id, p_user_id);

    -- Update user_activity table
    UPDATE discord.user_activity
    SET
        weekly_streak_current = v_weekly_current,
        weekly_streak_longest = v_weekly_longest,
        monthly_streak_current = v_monthly_current,
        monthly_streak_longest = v_monthly_longest,
        updated_at = NOW()
    WHERE guild_id = p_guild_id AND user_id = p_user_id;
END;
$$;

-- Update get_user_activity function to include streaks
DROP FUNCTION IF EXISTS discord.get_user_activity(VARCHAR, VARCHAR);

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
    daily_streak_current INT,
    daily_streak_longest INT,
    weekly_streak_current INT,
    weekly_streak_longest INT,
    monthly_streak_current INT,
    monthly_streak_longest INT,
    first_seen_at TIMESTAMP WITH TIME ZONE,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    last_activity_date DATE
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Update streaks before returning
    PERFORM discord.update_user_streaks(p_guild_id, p_user_id);

    RETURN QUERY
    SELECT
        ua.user_id,
        ua.username,
        ua.message_count,
        ua.voice_join_count,
        ua.total_voice_time,
        ua.daily_streak_current,
        ua.daily_streak_longest,
        ua.weekly_streak_current,
        ua.weekly_streak_longest,
        ua.monthly_streak_current,
        ua.monthly_streak_longest,
        ua.first_seen_at,
        ua.last_seen_at,
        ua.last_activity_date
    FROM discord.user_activity ua
    WHERE ua.guild_id = p_guild_id
        AND ua.user_id = p_user_id;
END;
$$;

-- Function to get top users by longest daily streak
CREATE OR REPLACE FUNCTION discord.get_top_streak_users(
    p_guild_id VARCHAR(255),
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    user_id VARCHAR(255),
    username VARCHAR(255),
    daily_streak_current INT,
    daily_streak_longest INT,
    weekly_streak_current INT,
    monthly_streak_current INT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ua.user_id,
        ua.username,
        ua.daily_streak_current,
        ua.daily_streak_longest,
        ua.weekly_streak_current,
        ua.monthly_streak_current
    FROM discord.user_activity ua
    WHERE ua.guild_id = p_guild_id
    ORDER BY ua.daily_streak_longest DESC, ua.daily_streak_current DESC
    LIMIT p_limit;
END;
$$;
