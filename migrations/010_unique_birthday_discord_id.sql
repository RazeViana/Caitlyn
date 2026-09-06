-- Refuse ambiguous legacy data. Resolve duplicate users explicitly before retrying.
-- No birthdays or historical dates are deleted or rewritten by this migration.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM discord.birthdays GROUP BY discord_id HAVING COUNT(*) > 1) THEN
        RAISE EXCEPTION 'Duplicate birthday Discord IDs require manual reconciliation before migration 010';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS birthdays_discord_id_key ON discord.birthdays (discord_id);
