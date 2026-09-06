# Caitlyn 2.0 modernization handoff

Updated: 2026-09-06. Modernization checkpoint: `8ea6f5e`. Signed resilience checkpoint: `b998543`, merged into local `caitlyn-2.0`. Current feature branch: `features/discord-logging`.

The TypeScript integration was already complete at `c468729` (`docs: record Caitlyn 2.0 follow-ups`). The original integration plan under `docs/superpowers/` describes that completed migration; use this file and [the task list](.todo) for current progress. The modernization continuation below was committed as `8ea6f5e`, and the resilience/documentation changes as `b998543`. The Discord logging implementation and verification are complete; its local integration target is `caitlyn-2.0`.

## Latest continuation: Discord logging

The owner requested a checkpoint commit and merge before starting server-configurable Discord logging. After reopening 1Password, signing succeeded: `b998543 feat: harden bot failure handling and organize documentation`. `caitlyn-2.0` was fast-forwarded to that commit, and `features/discord-logging` starts from the same base. No push or change to `main` was made.

The owner clarified that only the main server should receive logs, and log types must be selectable from that channel. Replaced the experimental per-server mode with one reserved main-server destination. `/setup logs|status|disable` is bot-owner-only; disabling retains the server reservation. `/logs levels types:info,warning,error` selects exact types, with `all` and `none` shortcuts; `/logs status` shows them. These commands require ownership and administrator permission, and `/logs` only works inside the configured channel. Level selections persist and operate independently of console `LOG_LEVEL`, including debug output while the console is filtered to INFO/ERROR.

No log-channel/server IDs are hard-coded. Legacy server-scope rows are ignored, not deleted or promoted. Other servers receive no logs or logging-onboarding announcements; global publication excludes `/setup` and `/logs`. Publish those private commands only to the main guild. Forwarding retains credential redaction, bounded queues/batching, backoff, channel privacy checks, and lifecycle cleanup. The `--global` publication option remains explicit and is never part of startup.

`npm run check` passed typechecking, lint, a clean build, and 112 tests with one opt-in database test skipped. The separately enabled disposable PostgreSQL suite passed all nine tests and cleaned up its own database. Migrations `011` and `012` are applied to verified local `127.0.0.1:5432/caitlyn_test`; the settings table contains zero configurations. Migration `012` adds level selection and reserves one main server even while forwarding is disabled. Existing application records and the homeserver are unchanged. AI remains disabled locally.

The owner requested a local checkpoint and merge into `caitlyn-2.0`; use Git history for the resulting integration commit. Nothing has been pushed or deployed. No live Discord login, slash-command publication, or channel messages were sent. Remaining release steps require separate authorization: apply migrations `011`/`012` to the intended deployment database, publish guild commands only to the main server, and verify `/setup logs` followed by `/logs levels` inside the private channel. See [private logging and setup](discord-logging.md) for commands, ownership, privacy, delivery limits, and remaining legacy multi-server constraints. The next feature candidate is durable birthday reminder catch-up and deduplication after outages, pending the owner's choice.

## Completed file conventions and documentation

Supporting project documentation is consolidated under `docs/`: the task list moved to `docs/.todo`, and private restore notes moved from `backups/README.md` to Git-ignored `docs/local-database.md` with owner-only permissions. At the owner's request, `README.md` is back at the repository root for GitHub, with links and conventions updated accordingly. Tool-discovery/configuration files remain where their tools require them.

Source, script, test, and type headers follow the existing `@file`, `@description`, and `@module` pattern, with accurate filenames and responsibilities. Keep new code in the established role-based folders; the conventions are recorded in [development instructions](development.md#file-headers). This cleanup changes comments and documentation, not runtime behavior.

Verification after cleanup: `npm run check` passed typechecking, lint, a clean build, and 88 tests (the opt-in PostgreSQL suite was skipped). All 71 JavaScript/TypeScript files have valid headers, their contents below those headers are unchanged by this cleanup, and all 66 local documentation links resolve. Private restore notes remain Git-ignored with mode `0600`. No database operations, commit, push, or deployment were performed for this cleanup.

## First improvements after the checkpoint

- Added `backups` to `.dockerignore`, complementing the Git exclusion. Local database data and private environment snapshots must not enter Docker build contexts.
- Added append-only migration `009_create_birthdays_table.sql`, matching the schema inspected in the copied database: serial primary key, bigint Discord ID, text name, and date of birth, all non-null. It creates the table only when absent and does not modify restored data. Migrations `001` through `008` are unchanged.
- Added an opt-in local PostgreSQL test covering the complete migration sequence, birthday schema, row and sequence preservation on replay, and birthday CRUD. All five tests passed against local PostgreSQL; the uniquely named test database was removed in cleanup. It used only synthetic data and did not touch the restored application database. Execution instructions are in `docs/development.md`.
- Documented that the existing migration runner has no history tracking and that replaying all historical migrations against a restored database is unsafe.

## Implemented error-handling improvements

The user authorized implementation of the application-wide error-handling audit. Startup readiness/cleanup, DB deadlines and error listeners, event containment, safe command responses, cooldowns, transactional activity writes, safe replacements, birthday date/upsert handling, AI/API resilience, and bounded shutdown are implemented. The Docker entry point now runs Node directly; command publication is separate and no longer clears global commands. See [resilience and rollout](resilience.md) for behavior contracts, tests, and remaining work; the [audit](error-handling-audit.md) retains the original findings.

The local `.env` had `LLM_ENABLED=true`; it is now `false`. The example configuration and missing-variable runtime default were already disabled. Added a regression test for the absent-variable/default-reset case. No running or remote bot was changed.

The disposable PostgreSQL suite passed all eight integration tests, including rollback at each voice write, concurrent completion counting a five-second session once, transactional message counters, and birthday uniqueness/upserts. At the resilience checkpoint, `npm run check` passed typechecking, lint, a clean ESM build, and 88 tests; the opt-in database suite was skipped during the ordinary run. The local application pool still targets `127.0.0.1:5432/caitlyn_test`, and AI remains disabled. These improvements are committed as `b998543`; nothing has been pushed.

Applied migrations `009` (no-op) and `010` to local `caitlyn_test` only, after confirming no duplicate birthdays. The unique Discord-ID index exists and all ten birthday rows/dates remain intact. No production migration or Discord publication was performed.

Historical snapshot cleanup is out of scope at the owner's request and has been removed from the active backlog. Database records and the runtime safeguards for ambiguous sessions remain unchanged. Durable birthday catch-up/deduplication remains a separate feature. Existing stored birthday dates were not rewritten.

## Completed in the modernization checkpoint

- Updated production dependencies to date-fns 4.4.0, Discord.js 14.27.0, dotenv 16.6.1, node-cron 4.6.0, and pg 8.23.0. Refreshed the transitive `ws` dependency within Discord.js's supported range. The full npm audit now reports zero vulnerabilities, down from four moderate and three high findings.
- Removed the unused `node-fetch` dependency. All HTTP callers already used Node.js fetch, and their existing behavior tests continue to pass.
- Removed `@types/node-cron`; v4 ships declarations. Birthday jobs still run at `0 9 * * *` in the host's local timezone. Their callbacks return the reminder promise so cron observes asynchronous completion and failure. A test exercises the actual v4 scheduler with a fake reminder and a fixed clock.
- Added `core/environment.ts`. Startup validates settings before creating the Discord client, contacting PostgreSQL, registering jobs, or logging in. Errors name every missing or malformed setting without printing its value. AI configuration is required even with AI initially disabled because `/toggleai` can enable it at runtime. Context counts default to five recent and three similar messages; zero is supported. See the [README](../README.md#configuration) and `.env.example` for the complete configuration contract.
- Moved Discord token validation from module import to login. Importing the application without credentials is safe. Command deployment rejects blank credentials and exits with status 1 on failure, allowing the Docker startup command to stop when deployment fails.
- Fixed four tests that depended on ambient log filtering by mocking logger methods. Kept separate tests for logger output and severity filtering. Compiled command/event discovery now runs with reversed filesystem enumeration and compares event membership without assuming directory order.

## Modernization checkpoint verification

- `npm run check`: strict typecheck, lint, clean ESM build, and all 70 tests passed.
- `LOG_LEVEL=ERROR npm test -- --test-reporter=dot` and `LOG_LEVEL=DEBUG npm test -- --test-reporter=dot`: all 70 tests passed under both settings.
- `npm audit --json`: zero vulnerabilities across production and development dependencies.
- `npm ls --depth=0`: the installed tree satisfies the manifest; the TypeScript 7 compiler / TypeScript 6 lint API arrangement is preserved.
- `git diff --check`: clean. No generated `dist` files are tracked.
- Tests use substitutes for Discord, PostgreSQL, AI endpoints, and Giphy. Compiled startup and command-deployment tests verify failure without credentials from isolated temporary directories.

## Remaining work

1. Verify the Docker image on a host with Docker installed. `command -v docker` exited with status 1 on this Mac; no local image build was possible. Run `docker build --tag caitlyn:2.0-integration .` on a Docker-enabled host.
2. Choose the license. `package.json` still says ISC and README still says MIT; there is no project license file. The choice remains with the owner.
3. Add durable birthday reminder catch-up and deduplication after outages; see the follow-ups in `docs/resilience.md`.

No push, command registration against Discord, image publication, workflow trigger, or homeserver update was performed during this continuation. Publishing or promoting the branch remains a separate release decision. Future feature branches use `caitlyn-2.0` as their base.

## Local database snapshot

On 2026-09-05, copied the production `caitlyn` database over Tailscale using the homeserver's PostgreSQL 17.8 tools. The verified custom-format dump is in the Git-ignored `backups/` directory alongside its archive listing and checksum metadata. Private restore instructions are in Git-ignored `docs/local-database.md`. The dump contains all five `discord` tables, including the birthday table absent from the historical migration set.

The source database was only read. The backup contains application data and must remain outside Git.

On 2026-09-05, installed PostgreSQL 17.11 and pgvector 0.8.6 through Homebrew, started the local service, and restored the snapshot into `caitlyn_test` at `127.0.0.1:5432` as the local role `raze`. The service listens on localhost and starts at login. Registered and connected `Caitlyn Local` in the existing pgAdmin app. All five table counts match the archive and all indexes are valid; details and service commands are in Git-ignored `docs/local-database.md`.

The project's `.env` now uses `PGHOST=127.0.0.1`, `PGPORT=5432`, `PGDATABASE=caitlyn_test`, and `PGUSER=raze`. `PGPASSWORD=[REDACTED: use the private local .env]` is a non-secret placeholder required by startup validation; local trust authentication does not use it. Verified the connection through the application's PostgreSQL pool and confirmed all five restored tables. The previous environment is saved privately in `backups/env-before-local-2026-09-05T09-20-34.859Z.env`. Other application settings were preserved.
