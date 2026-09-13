-- @file 016_social_source_replacement.sql
-- @description Persists safe source cleanup separately from preview delivery and user deletion events.
-- Existing jobs remain original-preserving; only new jobs may replace source messages.
-- @module socialSourceReplacement

ALTER TABLE discord.social_jobs
    ADD COLUMN IF NOT EXISTS source_cleanup TEXT NOT NULL DEFAULT 'preserve'
        CHECK (source_cleanup IN ('preserve', 'pending', 'deleting', 'deleted', 'retained')),
    ADD COLUMN IF NOT EXISTS replacement_ready BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sensitive BOOLEAN NOT NULL DEFAULT FALSE;
