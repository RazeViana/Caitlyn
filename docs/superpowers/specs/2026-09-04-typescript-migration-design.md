# TypeScript Migration Design

## Goal

Convert Caitlyn from JavaScript to TypeScript without changing the bot's user-visible behavior, code organization, or established formatting style. Use `tsx` for local development, `tsc` for type checking and production builds, and Node.js 24 LTS for the supported runtime.

## Scope

The migration covers the current entry point and every module under `commands`, `core`, `events`, `handlers`, `jobs`, and `messages`. It also covers package scripts, compiler configuration, lint configuration, Docker, and CI changes required to build and run the converted project.

The migration does not add activity tracking, redesign the LLM integration, change Discord command behavior, convert the project fully to ESM, or restructure existing modules. Defects exposed by the type checker will be fixed only where necessary to retain the intended current behavior; unrelated improvements remain separate tasks.

## Runtime and module strategy

- Target Node.js 24 LTS.
- Add TypeScript, `tsx`, and Node.js type definitions as development dependencies.
- Use Node-aware TypeScript module resolution while retaining CommonJS-compatible runtime behavior for this phase.
- Keep the dynamic command/event discovery and `/reload` patterns working. A full ESM conversion is deferred because ESM caching and path handling would require behavioral redesign.
- Use `.ts` for source files. The project has no JSX and therefore does not need `.tsx` source files.
- Emit production JavaScript into `dist` and run the emitted entry point with Node.js.

## Type boundaries

Add focused types at the existing module boundaries:

- Discord command modules, including execution and optional autocomplete handlers.
- Discord event modules and the arguments passed by the event loader.
- Required environment configuration used by Discord, PostgreSQL, birthday reminders, Giphy, and Ollama.
- Conversation messages exchanged with Ollama.
- Database rows read by the birthday features.

Avoid broad abstractions or a new framework. Types should describe the current code rather than force a redesign.

## Scripts and development flow

The package scripts will provide distinct commands for:

- Local execution through `tsx`.
- Watch-mode development through `tsx watch`.
- Type checking through `tsc --noEmit`.
- Production compilation through `tsc`.
- Production execution through `node dist/main.js`.
- Command deployment in both development and compiled production contexts.

`tsx` transpiles and executes TypeScript but does not replace the type-checking step.

## Migration sequence

1. Add small regression tests around current behavior that does not require live Discord or PostgreSQL access.
2. Add the TypeScript toolchain and configuration without changing runtime behavior.
3. Convert shared core and handler modules, followed by events, messages, jobs, commands, and the entry point.
4. Resolve type errors with narrow annotations and guards while retaining existing flows.
5. Update linting for TypeScript and keep the current tab indentation, double quotes, and semicolon conventions.
6. Update Docker and CI to type-check, test, compile, and run the emitted JavaScript.
7. Verify command loading, event loading, birthdays, social embeds, PostgreSQL initialization, and optional Ollama handling.

## Error handling

The type conversion will make asynchronous boundaries explicit and prevent unhandled promise rejections where doing so is necessary for stable existing behavior. Larger changes to retry policies, user-facing error responses, configuration validation, and LLM behavior will be documented as follow-up work instead of being bundled into the migration.

## Verification

The migration is complete when:

- All source files pass `tsc --noEmit`.
- The lint command runs successfully against TypeScript sources.
- Automated regression tests pass.
- The production build creates a runnable `dist/main.js` and all dynamically loaded modules are present in `dist`.
- The Docker image builds using Node.js 24 LTS.
- Existing command, event, birthday, embed, database, and optional LLM paths retain their current externally observable behavior.

Live Discord, PostgreSQL, Giphy, and Ollama checks will require the corresponding services and credentials. Automated tests will use isolated substitutes rather than contacting those services.
