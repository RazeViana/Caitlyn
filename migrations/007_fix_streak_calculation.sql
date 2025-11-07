-- Fix weekly and monthly streak calculation to only count complete periods
-- Current period (current week/month) will not count toward streak until it completes

-- Update weekly streak function to start from previous week
DROP FUNCTION IF EXISTS discord.calculate_weekly_streak(VARCHAR, VARCHAR);

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
    -- Start from PREVIOUS week (not current week)
    v_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
    v_last_week := v_week_start - INTERVAL '7 days';

    -- Calculate current streak (consecutive COMPLETE weeks with activity)
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
    v_week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE - INTERVAL '7 days';

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

-- Update monthly streak function to start from previous month
DROP FUNCTION IF EXISTS discord.calculate_monthly_streak(VARCHAR, VARCHAR);

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
    -- Start from PREVIOUS month (not current month)
    v_month_start := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_last_month := (v_month_start - INTERVAL '1 month')::DATE;

    -- Calculate current streak (consecutive COMPLETE months with activity)
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
    v_month_start := (DATE_TRUNC('month', CURRENT_DATE)::DATE - INTERVAL '1 month')::DATE;

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
