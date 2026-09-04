# Caitlyn 2.0 Integration Design

## Purpose

Create `caitlyn-2.0` from the current `main` branch and merge the completed TypeScript migration into it without publishing or triggering the `main` deployment pipeline. The resulting branch becomes the long-lived integration base for future feature branches and will replace `main` only after an explicit later instruction.

## Source of truth

Current `main` is the behavioral and architectural source of truth. The integration must retain its newer features:

- ES module runtime behavior
- Open WebUI-based AI integration
- persistent message and vector-memory storage
- activity, leaderboard, streak, and voice-state tracking
- AI enable/disable controls
- structured logging
- database migrations and operational scripts
- startup error handling and graceful process shutdown

The `typescript-migration` branch supplies the TypeScript toolchain, Node.js 24 runtime contract, strict typing, linting, build output, automated tests, Docker improvements, CI quality gate, and migration documentation. Older implementations from that branch must not replace newer `main` behavior.

## Module architecture

The merged application remains ESM:

- `package.json` keeps `"type": "module"` and version `2.1.0`.
- TypeScript uses `module` and `moduleResolution` set to `NodeNext`.
- Relative TypeScript imports use `.js` runtime specifiers so emitted modules resolve under Node.js.
- Application modules use named ESM exports, matching current `main` patterns.
- Dynamic command and event loaders select `.ts` while running through `tsx` and `.js` from compiled `dist`.
- `/reload` keeps ESM cache-busting behavior and reloads the selected source or compiled module using the current runtime extension.

The deleted in-memory `conversationStore` must not be restored. The newer PostgreSQL-backed `messageStore` remains the conversation-memory implementation.

## TypeScript conversion scope

All runtime application modules under `commands`, `core`, `events`, `handlers`, `jobs`, and `messages`, plus `main`, are converted to TypeScript. This includes every feature added to current `main` after the original migration branch split.

Shared contracts cover:

- Discord client command collection and command/event module shapes
- environment variables for Discord, PostgreSQL, Open WebUI, embeddings, AI controls, activity tracking, and birthday integrations
- database row and query result shapes
- Open WebUI request/response messages and vector-memory records
- command interaction, message, channel, guild, and scheduler boundaries where narrower types improve safety

Operational database scripts are converted to TypeScript when they are intended to execute project modules. The build-clean helper remains a small ESM JavaScript utility because it must run before TypeScript compilation.

## Merge and conflict policy

The integration is recorded as a real merge of `typescript-migration` into `caitlyn-2.0`. Because the two branches independently replaced the module architecture, the ancestry merge uses Git's `ours` strategy to avoid one unreviewable conflict-resolution snapshot; focused commits immediately afterward port the migration branch's TypeScript, test, build, Docker, and CI changes onto the newer ESM tree.

Conflict resolution follows these rules:

1. Preserve current `main` behavior and public command/database contracts.
2. Apply TypeScript types and tooling without reverting newer features.
3. Preserve ESM rather than the migration branch's older CommonJS compatibility layer.
4. Keep Node.js 24, clean `dist` builds, strict type checking, TypeScript-aware ESLint, and the verified TypeScript 7 compiler arrangement.
5. Regenerate `package-lock.json` from the manually reconciled manifest; never hand-merge lockfile conflict markers.
6. Keep generated `dist` output untracked.

The original `typescript-migration` branch remains intact after the merge.

## Testing strategy

The test suite runs through `node --import tsx --test` and uses ESM-compatible tests and explicit dependency seams instead of CommonJS module-cache mutation.

Tests must preserve and extend the migration coverage for:

- command and event discovery in source and compiled output
- birthday SQL, reminders, embeds, and schedules
- social-link replacement
- direct environment loading and PostgreSQL initialization
- Open WebUI request handling and optional AI responses
- message/vector-memory storage and context assembly
- AI enable/disable behavior
- activity, streak, leaderboard, and voice-state flows
- concurrent AI and social-message handling
- startup validation and compiled production entry points

All external Discord, PostgreSQL, Open WebUI, embedding, Giphy, timer, and network boundaries use deterministic substitutes. Tests must clean temporary files, environment changes, timers, and mutated singleton state.

## Build and deployment

- Development runs TypeScript through `tsx`.
- Production builds a clean ESM `dist` tree and starts `dist/main.js` on Node.js 24.
- Docker remains a two-stage Node.js 24 Alpine build with production-only runtime dependencies.
- CI installs dependencies, runs the complete quality gate, then builds and publishes the existing GHCR tags.
- The existing workflow trigger remains `main`; no branch or workflow is pushed during this integration.
- A local Docker build is attempted when Docker is available. An unavailable daemon is reported rather than treated as success.

## Branch and release policy

- `caitlyn-2.0` stays local until explicitly requested otherwise.
- Future feature branches start from `caitlyn-2.0`, not `main`.
- No push, pipeline trigger, image publication, or homeserver update occurs during this work.
- Replacing remote `main`, including any force-push, requires a separate explicit instruction after the integration branch is reviewed and verified.

## Completion criteria

The integration is complete when:

- the merge has no unresolved conflicts;
- all current `main` runtime features remain represented in TypeScript;
- lint, strict typecheck, clean build, and the complete test suite pass;
- emitted ESM modules load correctly from `dist`;
- Docker and CI configuration target the merged ESM build;
- `git diff --check` is clean and no generated output is tracked;
- the final branch review has no unresolved critical or important findings;
- the working tree is clean on `caitlyn-2.0` and nothing has been pushed.
