# Caitlyn Discord Bot

Caitlyn is a modular Discord bot built with Discord.js, TypeScript, PostgreSQL, pgvector, and Open WebUI. It provides conversational AI with persistent vector memory, activity tracking, birthday reminders, and social-link enhancements.

## Features

- Open WebUI chat integration with a runtime `/toggleai` control.
- PostgreSQL and pgvector conversation storage with recent and semantic context.
- Message, voice, leaderboard, and daily/weekly/monthly streak tracking.
- Birthday management and scheduled birthday reminders.
- Twitter/X, Instagram, Reddit, and TikTok link handling.
- Typed ESM command, event, job, and message modules.
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

4. Run migrations `001` through `008` in numeric order:

   ```bash
   npx tsx scripts/runMigration.ts 001_create_messages_table.sql
   npx tsx scripts/runMigration.ts 002_update_embedding_dimensions.sql
   npx tsx scripts/runMigration.ts 003_create_user_activity_table.sql
   npx tsx scripts/runMigration.ts 004_remove_server_leave_count.sql
   npx tsx scripts/runMigration.ts 005_update_get_user_activity_function.sql
   npx tsx scripts/runMigration.ts 006_add_activity_streaks.sql
   npx tsx scripts/runMigration.ts 007_fix_streak_calculation.sql
   npx tsx scripts/runMigration.ts 008_fix_daily_activity_tracking.sql
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

`npm start` executes `dist/main.js`, so run the build first. Generated `dist/` files are not committed. See [docs/development.md](docs/development.md) for code conventions and the branch/release policy.

## Configuration

The application reads these variables from `.env`:

| Variable | Purpose |
| --- | --- |
| `TOKEN` | Discord bot token |
| `CLIENT_ID` | Discord application/client ID used when deploying commands |
| `GUILD_ID` | Discord guild used for command deployment and reminders |
| `GENERAL_CHAT_ID` | Channel that receives birthday reminders |
| `GIPHY_API_KEY` | Giphy API key used by birthday responses |
| `PGHOST`, `PGPORT` | PostgreSQL server address |
| `PGUSER`, `PGPASSWORD`, `PGDATABASE` | PostgreSQL credentials and database |
| `LLM_ENABLED` | Initial AI state; use `true` or `false` |
| `OLLAMA_MODEL` | Model name sent to Open WebUI |
| `WEBUI_API_KEY` | Bearer token for Open WebUI |
| `WEBUI_CHAT_ENDPOINT` | Open WebUI chat-completions URL |
| `EMBEDDING_MODEL` | Embedding model name |
| `EMBEDDING_ENDPOINT` | Embeddings API URL |
| `CONTEXT_RECENT_COUNT` | Recent messages included in AI context |
| `CONTEXT_SIMILAR_COUNT` | Semantically similar messages included in AI context |
| `LOG_LEVEL` | Optional `DEBUG`, `INFO`, `WARN`, or `ERROR` threshold |

The Open WebUI model configuration owns the system prompt.

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

## Commands

### User commands

- `/activity [user]` — show detailed activity statistics.
- `/addbirthday` — add a birthday reminder.
- `/removebirthday` — remove a birthday reminder.
- `/showbirthdays` — list upcoming birthdays.

### Utility commands

- `/leaderboard [limit]` — rank members by activity.
- `/ping` — check bot latency.
- `/reload <command>` — reload a command at runtime.
- `/server` — show server information.
- `/streaks [limit]` — rank activity streaks.
- `/toggleai` — enable or disable AI replies at runtime (administrator only).
- `/user [user]` — show user information.

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
├── events/         # Discord event modules
├── handlers/       # Command, event, cron, and message routing
├── jobs/           # Scheduled jobs
├── messages/       # AI, birthday, and social-message flows
├── migrations/     # SQL migrations 001-008
├── scripts/        # TypeScript operational tools and the ESM build cleaner
├── tests/          # Node test runner behavior tests
├── types/          # Shared TypeScript contracts
└── main.ts         # Import-safe application entry point
```

## Code style

- Tabs for indentation.
- Double quotes for strings.
- Semicolons.
- Stroustrup braces.
- Named ESM exports and `.js` relative import specifiers in TypeScript.

## License

This project is licensed under the MIT License.
