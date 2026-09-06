-- Persist grouped birthday announcements and one reservation per person/server/date.
-- Existing birthdays and their dates are never rewritten. Apply before enabling recovery.
CREATE TABLE IF NOT EXISTS discord.birthday_deliveries (
    id UUID PRIMARY KEY,
    guild_id TEXT NOT NULL CHECK (guild_id ~ '^[1-9][0-9]*$'),
    channel_id TEXT NOT NULL CHECK (channel_id ~ '^[1-9][0-9]*$'),
    occurrence_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'sending', 'uncertain', 'sent', 'expired')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    message_id TEXT CHECK (message_id ~ '^[1-9][0-9]*$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, guild_id, occurrence_date),
    CHECK ((status = 'sent') = (message_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS discord.birthday_occurrences (
    guild_id TEXT NOT NULL,
    discord_id TEXT NOT NULL CHECK (discord_id ~ '^[1-9][0-9]*$'),
    occurrence_date DATE NOT NULL,
    delivery_id UUID NOT NULL,
    PRIMARY KEY (guild_id, discord_id, occurrence_date),
    FOREIGN KEY (delivery_id, guild_id, occurrence_date)
        REFERENCES discord.birthday_deliveries (id, guild_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS birthday_deliveries_pending
    ON discord.birthday_deliveries (guild_id, occurrence_date, next_attempt_at)
    WHERE status IN ('ready', 'sending', 'uncertain');

CREATE INDEX IF NOT EXISTS birthday_occurrences_delivery ON discord.birthday_occurrences (delivery_id);
