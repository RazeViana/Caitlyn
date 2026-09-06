-- Fresh databases need the birthday table that predates migrations 001-008.
-- Match the existing production schema without changing restored tables or data.
CREATE TABLE IF NOT EXISTS discord.birthdays (
    id SERIAL PRIMARY KEY,
    discord_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    dob DATE NOT NULL
);
