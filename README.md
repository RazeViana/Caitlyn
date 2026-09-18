# Caitlyn Discord Bot

Caitlyn is a modular Discord bot built with Discord.js, TypeScript, PostgreSQL, pgvector, and Open WebUI. It provides conversational AI with persistent vector memory, activity tracking, birthday reminders, and social-link enhancements.

## Documentation

- [Development and file conventions](docs/development.md)
- [Current progress and handoff](docs/handoff.md)
- [Task list](docs/.todo)
- [Resilience and rollout](docs/resilience.md)
- [Private main-server logging](docs/discord-logging.md)
- [Social-media replacement progress and feasibility](docs/social-media-replacement.md)
- [Opt-in social delivery and worker setup](docs/social-delivery.md)
- [TikTok videos, share links, and limits](docs/tiktok.md)
- [Self-hosted media API, dependencies, and local build](docs/self-hosted-media-api.md)
- [Local FxEmbed backend and configuration](docs/fxembed.md)
- [Exact FxEmbed installation inventory](docs/fxembed-installations.md)
- [Local isolated media tests](docs/local-media-testing.md)
- [Original error-handling audit](docs/error-handling-audit.md)
- [Historical integration design](docs/superpowers/specs/2026-09-04-caitlyn-2-integration-design.md) and [plan](docs/superpowers/plans/2026-09-04-caitlyn-2-integration.md)

The README stays at the repository root for GitHub; supporting project documentation lives under `docs/`. Private local restore notes are in Git-ignored `docs/local-database.md`; database dumps and environment snapshots remain in `backups/`. Unless stated otherwise, run commands below from the repository root.

## Features

- Open WebUI chat integration with a runtime `/toggleai` control.
- PostgreSQL and pgvector conversation storage with recent and semantic context.
- Message, voice, leaderboard, and daily/weekly/monthly streak tracking.
- Birthday management and scheduled reminders with same-day outage catch-up and persistent duplicate prevention.
- Opt-in X and TikTok video previews with isolated extraction, sender mentions, and safe original-message cleanup after complete delivery (disabled by default). TikTok mobile share links are resolved inside the worker. Failed or oversized content retains the original. Public sensitive-labelled X posts are supported; provider access gates are not bypassed.
- Public Instagram photo/reel/carousel integration supports captions, ordered attachments and formatted private/login notices. Photo/reel extraction and compression are verified without an account; the local bot is enabled for Discord acceptance testing. See [Instagram status and limitations](docs/instagram.md). Reddit development is parked.
- Typed ESM command, event, job, and message modules.
- Private main-server logging with owner-only channel setup and in-channel level selection.
- Dynamic loaders that run TypeScript in development and compiled JavaScript in production.

## Requirements

- Node.js 24
- npm 11
- PostgreSQL 14 or newer with the pgvector extension
- An Open WebUI chat-completions endpoint
- An embeddings endpoint compatible with the configured model
- A Discord application and bot token

## Setup

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/RazeViana/Caitlyn.git
   cd Caitlyn
   ```

2. Install the locked dependencies:

   ```bash
   npm ci
   ```

3. Copy `.env.example` to `.env` and fill in every value used by your deployment.

4. On a **new, empty database**, run migrations `001` through `016` in numeric order:

   ```bash
   npx tsx scripts/runMigration.ts 001_create_messages_table.sql
   npx tsx scripts/runMigration.ts 002_update_embedding_dimensions.sql
   npx tsx scripts/runMigration.ts 003_create_user_activity_table.sql
   npx tsx scripts/runMigration.ts 004_remove_server_leave_count.sql
   npx tsx scripts/runMigration.ts 005_update_get_user_activity_function.sql
   npx tsx scripts/runMigration.ts 006_add_activity_streaks.sql
   npx tsx scripts/runMigration.ts 007_fix_streak_calculation.sql
   npx tsx scripts/runMigration.ts 008_fix_daily_activity_tracking.sql
   npx tsx scripts/runMigration.ts 009_create_birthdays_table.sql
   npx tsx scripts/runMigration.ts 010_unique_birthday_discord_id.sql
   npx tsx scripts/runMigration.ts 011_create_guild_settings.sql
   npx tsx scripts/runMigration.ts 012_private_logging_levels.sql
   npx tsx scripts/runMigration.ts 013_birthday_delivery_tracking.sql
   npx tsx scripts/runMigration.ts 014_social_delivery.sql
   npx tsx scripts/runMigration.ts 015_quarantine_ambiguous_voice_sessions.sql
   npx tsx scripts/runMigration.ts 016_social_source_replacement.sql
   ```

5. Register the slash commands for the configured guild:

   ```bash
   npm run deploy
   ```

6. Start the bot in development:

   ```bash
   npm run dev
   ```

## Development and production

Run the complete local quality gate:

```bash
npm run check
```

Create a clean ESM build under `dist/`:

```bash
npm run build
```

Start that compiled build:

```bash
npm start
```

`npm start` executes `dist/main.js`, so run the build first. Generated `dist/` files are not committed. See [development instructions](docs/development.md) for code conventions and the branch/release policy.

The Docker image starts Node directly and does **not** register commands on every restart. Run `npm run deploy:prod` separately after building when publishing command changes. By default, deployment updates only the configured guild's commands; it does not clear global registrations. The explicit `--global` option publishes ordinary commands for all server installations, excluding the private `/setup` and `/logs` controls. See [failure handling and rollout notes](docs/resilience.md) and [logging setup](docs/discord-logging.md#database-and-command-rollout) before updating an existing installation.

## Configuration

The application reads these variables from `.env`:

| Variable | Purpose |
| --- | --- |
| `TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application/client ID used when deploying commands |
| `GUILD_ID` | Discord guild used for command deployment and reminders |
| `GENERAL_CHAT_ID` | Channel that receives birthday reminders |
| `BIRTHDAY_TIMEZONE` | Optional reminder timezone, e.g. `Europe/Brussels`; defaults to the host timezone |
| `GIPHY_API_KEY` | Giphy API key used by birthday responses |
| `PGHOST`, `PGPORT` | PostgreSQL server address |
| `PGUSER`, `PGPASSWORD`, `PGDATABASE` | PostgreSQL credentials and database |
| `LLM_ENABLED` | Initial AI state; use `true` or `false` |
| `SOCIAL_MEDIA_ENABLED` | Optional social worker integration switch; defaults to `false`; channel opt-in is also required. Instagram is experimental; see its status documentation |
| `SOCIAL_WORKER_SOCKET` | Absolute private local Unix socket path; required only when social integration is enabled |
| `OLLAMA_MODEL` | Model name sent to Open WebUI |
| `WEBUI_API_KEY` | Bearer token for Open WebUI |
| `WEBUI_CHAT_ENDPOINT` | Open WebUI chat-completions URL |
| `EMBEDDING_MODEL` | Embedding model name |
| `EMBEDDING_ENDPOINT` | Embeddings API URL |
| `CONTEXT_RECENT_COUNT` | Optional recent-message count; defaults to `5` |
| `CONTEXT_SIMILAR_COUNT` | Optional similar-message count; defaults to `3` |
| `LOG_LEVEL` | Optional console `DEBUG`, `INFO`, `WARN`, or `ERROR` threshold; Discord types are configured with `/logs levels` |

The Open WebUI model configuration owns the system prompt.

The separate media broker provides Caitlyn's [self-hosted media API](docs/self-hosted-media-api.md). X uses `SOCIAL_X_PROVIDER=fxembed`, the pinned FxEmbed backend inside this project, never hosted VX/Fx APIs. [TikTok](docs/tiktok.md) uses the already pinned extractor inside the isolated worker, without FxEmbed or an account. Bot-facing endpoints remain on an owner-only Unix socket. Export broker settings when starting the broker, not the bot.

See [FxEmbed setup and limitations](docs/fxembed.md). No account is connected automatically. Upstream documents that NSFW/restricted posts may require authorized X account credentials; switching backends does not remove that requirement.

Only `TOKEN` is essential for bot startup. Missing or invalid optional settings disable the affected feature and produce startup diagnostics containing variable names, never their values. Without database configuration, basic commands and configured AI chat still work; database commands explain that the feature is disabled. Missing AI settings prevent `/toggleai` from enabling replies; missing embedding/database settings disable memory without disabling chat. Missing Giphy settings skip GIF requests without disabling birthdays. Missing birthday destination settings stop reminders without disabling birthday storage. See the [feature configuration map](docs/feature-configuration.md).

`LLM_ENABLED` and `SOCIAL_MEDIA_ENABLED` default to `false`. Social delivery needs valid database/socket configuration, migrations `014`/`016`, a separately running isolated worker, and administrator channel opt-in; see [setup and limitations](docs/social-delivery.md). Restart after changing `.env`; configured AI can still be toggled in memory.

Birthday reminders are due at 9 AM in the selected timezone, with checks on startup and every five minutes until local midnight. Missed previous days are not replayed. Apply migration `013` before using recovery; the bot needs Read Message History in the birthday channel. See [birthday recovery](docs/birthday-recovery.md) for delivery tracking, uncertainty handling, logging, and the first-deployment precautions.

`GUILD_ID` and `GENERAL_CHAT_ID` must be numeric Discord IDs. `PGPORT` must be an integer from `1` to `65535`; context counts must be nonnegative PostgreSQL integers. Both AI endpoints must be absolute HTTP or HTTPS URLs without embedded credentials. Invalid optional values disable only their dependent features; invalid `LOG_LEVEL` falls back to `INFO` with a warning. Command deployment still requires nonempty `TOKEN`, `CLIENT_ID`, and `GUILD_ID`, and exits unsuccessfully on configuration or deployment failure. Configured database connection failures retain the existing bounded startup retry/failure behavior; missing configuration is not a health check.

## Database migrations

Migrations are append-only and must be applied in filename order:

1. `001_create_messages_table.sql` creates pgvector support, the `discord` schema, message storage, indexes, and context functions.
2. `002_update_embedding_dimensions.sql` changes stored embeddings and similarity search to 768 dimensions.
3. `003_create_user_activity_table.sql` adds aggregate activity and voice-session tracking.
4. `004_remove_server_leave_count.sql` removes the obsolete server-leave counter.
5. `005_update_get_user_activity_function.sql` updates the activity lookup function after that removal.
6. `006_add_activity_streaks.sql` adds daily activity and streak functions.
7. `007_fix_streak_calculation.sql` counts only completed weeks and months.
8. `008_fix_daily_activity_tracking.sql` separates daily message and voice-time accounting.
9. `009_create_birthdays_table.sql` adds the legacy birthday table for fresh databases; existing birthday tables and data are left untouched.
10. `010_unique_birthday_discord_id.sql` adds the unique Discord-ID index required by birthday upserts. It stops with an error if duplicates exist and never deletes or rewrites birthdays.
11. `011_create_guild_settings.sql` stores each server's logging configuration and permits one owner-controlled console destination.
12. `012_private_logging_levels.sql` persists the Discord type selection and reserves one main logging server even while forwarding is disabled. Legacy server-scoped destinations are ignored by the application.
13. `013_birthday_delivery_tracking.sql` stores grouped birthday delivery state and unique server/person/date reservations without modifying existing birthdays.
14. `014_social_delivery.sql` adds disabled-by-default social channel settings and durable, leased preview jobs.
15. `015_quarantine_ambiguous_voice_sessions.sql` flags ambiguous historical open sessions without changing their timestamps or totals, and prevents duplicate actively tracked sessions. Required for the updated voice tracker.
16. `016_social_source_replacement.sql` tracks replacement completeness, sensitivity, and source cleanup. Existing jobs retain their originals; new complete deliveries can remove unchanged source messages safely. Required for social delivery.

Apply only migrations that the target database has not already received. The runner does not track migration history; do not replay the entire set on a restored database, since historical migrations can replace stored embeddings. See [database verification](docs/development.md#database-work) for an isolated local migration test.

## Commands

### User commands

- `/activity [user]` — show detailed activity statistics.
- `/addbirthday` — add a birthday reminder.
- `/removebirthday` — remove a birthday reminder.
- `/showbirthdays` — list upcoming birthdays.

### Utility commands

- `/leaderboard [limit]` — rank members by activity.
- `/ping` — check bot latency.
- `/reload <command>` — reload a command at runtime (administrator only).
- `/server` — show server information.
- `/setup logs|status|disable` — configure the private main-server logging channel (bot owner with administrator permission only).
- `/logs levels types:info,warning,error` and `/logs status` — select or inspect log types from inside the logging channel (bot owner only); `all` and `none` are also supported.
- `/streaks [limit]` — rank activity streaks.
- `/social enable|disable|disable-server|status` — configure opt-in social previews in server text channels (administrator only; requires operator-enabled worker integration). Updated command descriptions include experimental Instagram support; register them when deploying that worker.
- `/toggleai` — enable or disable AI replies at runtime (administrator only).
- `/user` — show information about the user who runs the command.

## Operational scripts

Run operational scripts from the repository checkout with `tsx`:

```bash
npx tsx scripts/checkMessages.ts
npx tsx scripts/testContext.ts
npx tsx scripts/testMemory.ts <channel_id>
```

`testMemory.ts` deletes stored messages for the supplied channel before printing manual memory-test steps.

## Project structure

```text
Caitlyn/
├── commands/       # Slash-command modules
├── core/           # PostgreSQL, AI, logging, deployment, and Discord services
├── docs/           # Task list, handoff, guides, audits, and plans
├── events/         # Discord event modules
├── handlers/       # Command, event, cron, and message routing
├── jobs/           # Scheduled jobs
├── messages/       # AI, birthday, and social-message flows
├── migrations/     # Append-only SQL migrations
├── scripts/        # TypeScript operational tools and the ESM build cleaner
├── tests/          # Node test runner behavior tests
├── types/          # Shared TypeScript contracts
├── vendor/         # Pinned third-party FxEmbed source (upstream style retained)
├── main.ts         # Import-safe application entry point
└── README.md       # GitHub project overview and documentation entry point
```

## Code style

- Tabs for indentation.
- Double quotes for strings.
- Semicolons.
- Stroustrup braces.
- Named ESM exports and `.js` relative import specifiers in TypeScript.
- A top-of-file `@file`, `@description`, and `@module` comment using the actual filename.

## License

This project is licensed under the MIT License.
