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
