# Setup

## Discord

Create an application and bot in the Discord Developer Portal. Enable Server Members Intent and Message Content Intent. Invite it with the `bot` and `applications.commands` scopes.

The bot needs View Channel, Send Messages and Embed Links where it replies. Social uploads also need Attach Files. Removing a replaced link needs Manage Messages; without it, the original stays. Birthday delivery and recovery need Read Message History. Choose a private text channel for logs and restrict access using Discord's channel permissions.

Install Node.js 24 and npm 11, then run `npm ci` from the repository root. Copy `.env.example` to `.env`, replace the values you need and remove unused placeholders. Never commit `.env` or database backups.

## Database

Use PostgreSQL with pgvector installed. PostgreSQL 17 is used on the mainframe. Set all five `PG*` variables below.

For a **new, empty database only**, apply migrations `001` through `016` in numeric order:

```bash
npx --no-install tsx scripts/runMigration.ts 001_create_messages_table.sql
npx --no-install tsx scripts/runMigration.ts 002_update_embedding_dimensions.sql
npx --no-install tsx scripts/runMigration.ts 003_create_user_activity_table.sql
npx --no-install tsx scripts/runMigration.ts 004_remove_server_leave_count.sql
npx --no-install tsx scripts/runMigration.ts 005_update_get_user_activity_function.sql
npx --no-install tsx scripts/runMigration.ts 006_add_activity_streaks.sql
npx --no-install tsx scripts/runMigration.ts 007_fix_streak_calculation.sql
npx --no-install tsx scripts/runMigration.ts 008_fix_daily_activity_tracking.sql
npx --no-install tsx scripts/runMigration.ts 009_create_birthdays_table.sql
npx --no-install tsx scripts/runMigration.ts 010_unique_birthday_discord_id.sql
npx --no-install tsx scripts/runMigration.ts 011_create_guild_settings.sql
npx --no-install tsx scripts/runMigration.ts 012_private_logging_levels.sql
npx --no-install tsx scripts/runMigration.ts 013_birthday_delivery_tracking.sql
npx --no-install tsx scripts/runMigration.ts 014_social_delivery.sql
npx --no-install tsx scripts/runMigration.ts 015_quarantine_ambiguous_voice_sessions.sql
npx --no-install tsx scripts/runMigration.ts 016_social_source_replacement.sql
```

On an existing or restored database, **back up first and apply only missing migrations**. The runner does not record migration history. Replaying `002` replaces stored embeddings; do not run the whole list to upgrade an existing installation. Migration `010` stops on duplicate birthdays rather than deleting them. Migration `015` flags ambiguous old voice sessions without changing their recorded times or totals.

See [database checks](development.md#database-work), [birthday recovery](birthday-recovery.md) and [migration precautions](resilience.md#database-rollout).

## Environment variables

| Settings | Purpose |
| --- | --- |
| `TOKEN` | Discord bot token. The only required setting for bot startup. |
| `CLIENT_ID`, `GUILD_ID` | Discord application ID and server ID for guild command registration. |
| `GENERAL_CHAT_ID` | Birthday reminder channel in `GUILD_ID`. |
| `BIRTHDAY_TIMEZONE` | Reminder timezone, such as `Europe/Amsterdam`. Defaults to the host timezone. |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | PostgreSQL connection. All five are required for database-backed features. |
| `GIPHY_API_KEY` | Optional birthday GIFs. Birthdays still work without it. |
| `LLM_ENABLED` | Initial AI state. Defaults to `false`. |
| `OLLAMA_MODEL`, `WEBUI_API_KEY`, `WEBUI_CHAT_ENDPOINT` | Model, API key and Open WebUI chat-completions endpoint. |
| `EMBEDDING_MODEL`, `EMBEDDING_ENDPOINT` | Embeddings service for saved AI memory. The database expects 768-dimensional embeddings. |
| `CONTEXT_RECENT_COUNT`, `CONTEXT_SIMILAR_COUNT` | Context limits; defaults are 5 recent and 3 similar messages. |
| `SOCIAL_MEDIA_ENABLED` | Enable the worker connection. Defaults to `false`; channels also need `/social enable`. |
| `SOCIAL_WORKER_SOCKET` | Absolute path to the media broker's private Unix socket. |
| `LOG_LEVEL` | Console threshold: `DEBUG`, `INFO`, `WARN` or `ERROR`. Defaults to `INFO`. Discord levels are set separately with `/logs levels`. |

Set the AI system prompt in the Open WebUI model settings. Without embedding/database settings, configured AI chat can still run without saved memory. Without AI settings, `/toggleai` cannot enable replies. Startup warnings name missing settings without printing credentials.

Restart after editing `.env`. `/toggleai` changes only the running bot's state, not the file. Database settings and channel permissions must also be working; valid-looking environment values are not a connection test.

## Start and configure

```bash
npm run deploy
npm run dev
```

For the compiled bot, run `npm run build`, `npm run deploy:prod` when command definitions change, then `npm start`. Use only one running instance per Discord token. `npm run deploy -- --global` publishes ordinary commands for other server installations, excluding private `/setup` and `/logs` controls; it does not replace the configured guild's operator commands.

In Discord:

1. As the bot owner and a server administrator, use `/setup logs channel:` to choose a private log channel.
2. In that channel, use `/logs levels types:info,success,warning,error` or add `debug` for collection details without message text.
3. Start the media services following [social setup](social-delivery.md) and [FxEmbed setup](fxembed.md), then use `/social enable` in each channel that should process links.
4. Add birthdays with `/addbirthday`. Reminders run at 9 AM in the configured timezone, with checks every five minutes and catch-up only on the same day.

The broker and FxEmbed have separate configuration and credentials. Do not give the bot container access to Docker or X session files. See [automatic deployment](automatic-deployment.md) for the supervised mainframe setup.

## Diagnostic scripts

`scripts/checkMessages.ts` and `scripts/testContext.ts` inspect configured AI memory. `scripts/testMemory.ts <channel_id>` **deletes saved messages for that channel** before printing test instructions; it is not a read-only check. Do not run it against data you want to keep.
