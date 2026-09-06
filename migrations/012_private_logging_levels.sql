-- @file 012_private_logging_levels.sql
-- @description Persists level selection and reserves logging for one main server, even while disabled.
-- Existing legacy server-scoped rows remain intact but are ignored by the application.
-- @module private_logging_levels

ALTER TABLE discord.guild_settings
    ADD COLUMN IF NOT EXISTS log_levels TEXT[] NOT NULL DEFAULT ARRAY['INFO', 'SUCCESS', 'WARN', 'ERROR']
    CHECK (log_levels <@ ARRAY['DEBUG', 'INFO', 'SUCCESS', 'WARN', 'ERROR']::TEXT[]
        AND array_position(log_levels, NULL) IS NULL
        AND cardinality(log_levels) <= 5);

-- Refuse conflicting operator destinations rather than choosing or deleting one.
CREATE UNIQUE INDEX IF NOT EXISTS guild_settings_main_logging_server
    ON discord.guild_settings (log_scope) WHERE log_scope = 'console';
