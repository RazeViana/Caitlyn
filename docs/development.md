# Development

## Local workflow

Use Node.js 24 and npm 11. Install the lockfile exactly, then run the complete quality gate before committing:

```bash
npm ci
npm run check
```

Use `npm run dev` for a one-off TypeScript process or `npm run dev:watch` while editing. Production runs the compiled ESM tree:

```bash
npm run build
npm start
```

The build always removes the old `dist/` tree first. Do not commit generated output.

Start with [the project README](../README.md), [the modernization handoff](handoff.md), and [the current task list](.todo). The integration plan under `docs/superpowers/` records the earlier TypeScript migration; its original unchecked steps are historical, not the current task list.

To check test isolation from local logging settings:

```bash
LOG_LEVEL=ERROR npm test
LOG_LEVEL=DEBUG npm test
```

Behavior tests mock logger methods when asserting that a message was requested. Logger formatting and level filtering have their own isolated subprocess tests. Compiled discovery tests reverse directory enumeration and compare command/event membership without relying on filesystem order.

For dependency maintenance, preserve the TypeScript 7 compiler / TypeScript 6 parser-API arrangement. Runtime HTTP calls use Node.js fetch. `node-cron` v4 includes its own TypeScript declarations, and scheduled callbacks must return their promises so the scheduler can observe completion and failure. See the [node-cron migration guide](https://www.nodecron.com/migrating-from-v3.html).

## TypeScript and ESM conventions

- Keep runtime source in TypeScript.
- Use named ESM exports.
- Write relative TypeScript imports with `.js` specifiers so Node.js can resolve emitted files.
- Keep tabs, double quotes, semicolons, and Stroustrup braces.
- Add behavior tests under `tests/` and keep external Discord, PostgreSQL, Open WebUI, embeddings, Giphy, timer, and network calls behind deterministic substitutes.

### File headers

When creating or editing a source file, follow the existing top-of-file JSDoc pattern. Use the exact filename, including its extension and case, a description of the module's responsibility, and its module name. Keep the description accurate when behavior changes; function-level comments supplement this header rather than replacing it.

```typescript
/**
 * @file birthdayDate.ts
 * @description Validates date-only birthdays and calculates their next calendar occurrence.
 * Handles leap days without shifting stored dates across timezones.
 *
 * @module birthdayDate
 */
```

Apply the same pattern to runtime modules, operational scripts, tests, shared types, and JavaScript configuration files. Tests use their filename stem as the module name, such as `resilience.test`. Use native comment syntax for other comment-capable formats, such as `--` in new SQL migrations. Do not rewrite applied migrations just to change comments, or add comments to JSON files.

### Folder structure and documentation

Place files by responsibility and follow their neighboring modules. Keep the existing category folders and naming style; do not scatter helpers, tests, or notes alongside unrelated code.

| Location | Contents |
| --- | --- |
| `main.ts` | Application entry point and lifecycle orchestration |
| `core/` | Shared services and helpers, including database, dates, timeouts, and interaction responses |
| `commands/user/`, `commands/utility/` | Slash commands grouped by their existing category |
| `events/` | Discord event entry points |
| `handlers/` | Module discovery and event, command, message, or job routing |
| `jobs/` | Scheduled tasks |
| `messages/` | AI, birthday, and social-message flows |
| `migrations/` | Append-only numbered SQL migrations |
| `scripts/` | Operational tools and build scripts |
| `tests/` | Automated tests, separate from runtime modules |
| `types/` | Shared TypeScript contracts and declarations |
| `README.md` | GitHub project overview and documentation entry point at the repository root |
| `docs/` | `.todo`, handoff, development guides, audits, and plans/specifications |
| `backups/` | Private database archives and environment snapshots, never documentation |

Keep `README.md` at the repository root for GitHub and place all supporting project documentation under `docs/`. Existing plan/specification subfolders may remain nested there. Local restore notes belong in Git-ignored `docs/local-database.md`, not beside database archives; preserve their ignore rule and owner-only permissions. Tool-discovery files such as `CLAUDE.md`, package/build configuration, and workflow files stay in the locations their tools require.

## Database work

Run SQL migrations in filename order with the source-time migration runner:

```bash
npx tsx scripts/runMigration.ts <migration_file.sql>
```

A migration filename resolves from the repository's `migrations/` directory even if the command is launched with a different working directory. Migrations `001` through `012` are documented in the [project README](../README.md#database-migrations). Migration `009` matches the legacy birthday table and is safe when that table already exists. Migration `010` adds the unique Discord-ID index required by upserts and stops rather than deleting duplicate birthdays. Migrations `011`/`012` persist private logging settings, exact type selection, and the main-server reservation. Historical migrations `001` through `008` remain unchanged.

The runner does not track applied migrations. Run the full sequence only on a new database; on restored databases, apply only missing migrations. In particular, replaying `002` replaces the embedding column and its data.

To verify the migration sequence using local PostgreSQL with pgvector installed:

```bash
CAITLYN_TEST_POSTGRES=1 node --import tsx --test tests/databaseMigrations.test.js
```

This opt-in test creates a uniquely named `caitlyn_migrations_*` database from `template0`, applies all migrations, checks birthday storage and repeat-application safety, and drops only its own database in cleanup. It also injects activity-write failures and concurrent voice retries using the application's transaction helper. Connections use only explicit test configuration: `127.0.0.1`, port `5432`, and the current OS user by default. Application imports may load `.env`, but its connection values never select the test target. The local role needs permission to create databases and install pgvector. Override the port, role, or password with `CAITLYN_TEST_PGPORT`, `CAITLYN_TEST_PGUSER`, and `CAITLYN_TEST_PGPASSWORD` if needed. The test is skipped during ordinary `npm test` unless explicitly enabled.

Failure-handling contracts, migration requirements, and remaining rollout work are documented in [resilience and rollout](resilience.md). Never test outages by stopping production services or logging a test process into the real Discord bot.

For private channel setup, owner-only `/logs levels`, delivery limits, and command publication, see [Discord logging](discord-logging.md). Preserve `withLogGuild` context when adding background work, but forward records only to the main-server destination. Operator-only logging controls must not be included in global command publication. Discord type filtering is independent of console `LOG_LEVEL`.

[Birthday recovery](birthday-recovery.md) adds migration `013`, startup/five-minute checks, unique occurrence reservations, and conservative delivery reconciliation. Test sends must use injected Discord substitutes, not the live bot. The PostgreSQL suite checks batching, concurrent reservations/claims, persisted backoff, rollback, and migration replay without modifying stored birthday dates. Keep its delivery bookkeeping and short database transactions separate from Discord requests.

Keep database dumps and private environment snapshots under `backups/`. Both Git and Docker build contexts exclude that directory; never remove these exclusions when sharing or building the project.

## Branch base

Create future feature branches from `caitlyn-3.0`. The integration branch was renamed from `caitlyn-2.0` locally and on GitHub on 2026-09-06; historical integration plans retain the former name.
Do not target or update `main` without an explicit release decision because pushes to `main` deploy to the homeserver.

Keep new commits on `caitlyn-3.0` local unless a separate instruction explicitly authorizes publishing them. Renaming the GitHub branch did not push the local feature commits. Replacing remote `main`, including a force-push, is a release action and is not part of normal feature development. This branch rename does not change package versions or deployment targets.
