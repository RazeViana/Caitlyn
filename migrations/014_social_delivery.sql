-- @file 014_social_delivery.sql
-- @description Adds opt-in social channels and durable, fenced preview delivery jobs.
-- @module socialDeliveryMigration

CREATE TABLE IF NOT EXISTS discord.social_channels (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, channel_id)
);

CREATE TABLE IF NOT EXISTS discord.social_jobs (
    id UUID PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    post_id TEXT NOT NULL,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'sending', 'uncertain', 'sent', 'removing', 'cancelled', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_token UUID,
    cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
    message_id TEXT,
    last_outcome TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
    UNIQUE (guild_id, channel_id, source_id, post_id)
);

CREATE INDEX IF NOT EXISTS social_jobs_pending ON discord.social_jobs (next_attempt_at, created_at)
    WHERE status IN ('queued', 'processing', 'sending', 'uncertain', 'removing', 'sent');
CREATE INDEX IF NOT EXISTS social_jobs_source ON discord.social_jobs (guild_id, channel_id, source_id);
