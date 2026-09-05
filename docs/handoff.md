# Caitlyn 2.0 modernization handoff

Updated: 2026-09-05. Continue on `caitlyn-2.0`.

The TypeScript integration was already complete at `c468729` (`docs: record Caitlyn 2.0 follow-ups`). The original integration plan under `docs/superpowers/` describes that completed migration; use this file and `.todo` for current progress. The continuation changes are in the working tree for review.

## Completed in this continuation

- Updated production dependencies to date-fns 4.4.0, Discord.js 14.27.0, dotenv 16.6.1, node-cron 4.6.0, and pg 8.23.0. Refreshed the transitive `ws` dependency within Discord.js's supported range. The full npm audit now reports zero vulnerabilities, down from four moderate and three high findings.
- Removed the unused `node-fetch` dependency. All HTTP callers already used Node.js fetch, and their existing behavior tests continue to pass.
- Removed `@types/node-cron`; v4 ships declarations. Birthday jobs still run at `0 9 * * *` in the host's local timezone. Their callbacks return the reminder promise so cron observes asynchronous completion and failure. A test exercises the actual v4 scheduler with a fake reminder and a fixed clock.
- Added `core/environment.ts`. Startup validates settings before creating the Discord client, contacting PostgreSQL, registering jobs, or logging in. Errors name every missing or malformed setting without printing its value. AI configuration is required even with AI initially disabled because `/toggleai` can enable it at runtime. Context counts default to five recent and three similar messages; zero is supported. See README and `.env.example` for the complete configuration contract.
- Moved Discord token validation from module import to login. Importing the application without credentials is safe. Command deployment rejects blank credentials and exits with status 1 on failure, allowing the Docker startup command to stop when deployment fails.
- Fixed four tests that depended on ambient log filtering by mocking logger methods. Kept separate tests for logger output and severity filtering. Compiled command/event discovery now runs with reversed filesystem enumeration and compares event membership without assuming directory order.

## Verification

- `npm run check`: strict typecheck, lint, clean ESM build, and all 70 tests passed.
- `LOG_LEVEL=ERROR npm test -- --test-reporter=dot` and `LOG_LEVEL=DEBUG npm test -- --test-reporter=dot`: all 70 tests passed under both settings.
- `npm audit --json`: zero vulnerabilities across production and development dependencies.
- `npm ls --depth=0`: the installed tree satisfies the manifest; the TypeScript 7 compiler / TypeScript 6 lint API arrangement is preserved.
- `git diff --check`: clean. No generated `dist` files are tracked.
- Tests use substitutes for Discord, PostgreSQL, AI endpoints, and Giphy. Compiled startup and command-deployment tests verify failure without credentials from isolated temporary directories.

## Remaining work

1. Verify the Docker image on a host with Docker installed. `command -v docker` exited with status 1 on this Mac; no local image build was possible. Run `docker build --tag caitlyn:2.0-integration .` on a Docker-enabled host.
2. Choose the license. `package.json` still says ISC and README still says MIT; there is no project license file. The choice remains with the owner.

No push, command registration against Discord, image publication, workflow trigger, or homeserver update was performed during this continuation. Publishing or promoting the branch remains a separate release decision. Future feature branches use `caitlyn-2.0` as their base.

## Local database snapshot

On 2026-09-05, copied the production `caitlyn` database over Tailscale using the homeserver's PostgreSQL 17.8 tools. The verified custom-format dump is in the Git-ignored `backups/` directory, alongside its archive listing, checksum metadata, and restore instructions in `backups/README.md`. It contains all five `discord` tables, including the birthday table absent from the historical migration set.

The source database was only read. The backup contains application data and must remain outside Git.

On 2026-09-05, installed PostgreSQL 17.11 and pgvector 0.8.6 through Homebrew, started the local service, and restored the snapshot into `caitlyn_test` at `127.0.0.1:5432` as the local role `raze`. The service listens on localhost and starts at login. Registered and connected `Caitlyn Local` in the existing pgAdmin app. All five table counts match the archive and all indexes are valid; details and service commands are in `backups/README.md`.

The project's `.env` now uses `PGHOST=127.0.0.1`, `PGPORT=5432`, `PGDATABASE=caitlyn_test`, and `PGUSER=raze`. `PGPASSWORD=[REDACTED: use the private local .env]` is a non-secret placeholder required by startup validation; local trust authentication does not use it. Verified the connection through the application's PostgreSQL pool and confirmed all five restored tables. The previous environment is saved privately in `backups/env-before-local-2026-09-05T09-20-34.859Z.env`. Other application settings were preserved.
