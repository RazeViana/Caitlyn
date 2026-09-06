-- @file 011_create_guild_settings.sql
-- @description Stores per-server log configuration and permits one trusted console destination.
-- @module guild_settings

CREATE TABLE IF NOT EXISTS discord.guild_settings (
    guild_id TEXT PRIMARY KEY CHECK (guild_id ~ '^[1-9][0-9]*$'),
    log_channel_id TEXT CHECK (log_channel_id ~ '^[1-9][0-9]*$'),
    log_scope TEXT NOT NULL DEFAULT 'server' CHECK (log_scope IN ('server', 'console')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS guild_settings_console_destination
    ON discord.guild_settings (log_scope)
    WHERE log_scope = 'console' AND log_channel_id IS NOT NULL;
