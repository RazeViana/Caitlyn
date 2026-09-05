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

The latest continuation notes and remaining work are in [the modernization handoff](handoff.md). The integration plan under `docs/superpowers/` records the earlier TypeScript migration; its original unchecked steps are historical, not the current task list.

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

## Database work

Run SQL migrations in filename order with the source-time migration runner:

```bash
npx tsx scripts/runMigration.ts <migration_file.sql>
```

A migration filename resolves from the repository's `migrations/` directory even if the command is launched with a different working directory. Existing migrations `001` through `008` are documented in the project README.

## Branch base

Until Caitlyn 2.0 is promoted, create feature branches from `caitlyn-2.0`.
Do not target or update `main` without an explicit release decision because pushes to `main` deploy to the homeserver.

Keep `caitlyn-2.0` local unless a separate release instruction explicitly authorizes publishing it. Replacing remote `main`, including a force-push, is a release action and is not part of normal feature development.
