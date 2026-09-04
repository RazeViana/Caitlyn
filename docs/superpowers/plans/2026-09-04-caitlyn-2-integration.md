# Caitlyn 2.0 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a local `caitlyn-2.0` integration branch that retains every current `main` feature while applying the completed TypeScript, Node.js 24, test, build, Docker, and CI migration.

**Architecture:** Keep current `main` as an ESM application and port the migration branch onto it in focused commits. Record `typescript-migration` as merged with an ancestry-only `ours` merge, then convert and verify the newer ESM modules instead of resolving the divergent histories in one unreviewable merge commit.

**Tech Stack:** Node.js 24, npm 11, TypeScript 7 native compiler, TypeScript 6 API compatibility package, `tsx`, ESM/NodeNext, Discord.js 14, PostgreSQL/pgvector, Open WebUI, Node test runner, ESLint flat config, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-caitlyn-2-integration-design.md`

## Global Constraints

- `caitlyn-2.0` stays local; do not push, publish an image, trigger a workflow, or update the homeserver.
- Current `main` behavior and its ESM architecture are authoritative when branch implementations differ.
- Keep package version `2.1.0` and `"type": "module"`.
- Keep the branch name exactly `caitlyn-2.0`; future feature branches use it as their base.
- Preserve command names, replies, SQL, schedules, environment names, GHCR tags, and the workflow's `main` trigger.
- Use `.js` relative import specifiers from TypeScript so emitted NodeNext ESM resolves from `dist`.
- Runtime loaders accept `.ts` under `tsx` and `.js` under Node.js from `dist`.
- Do not restore `core/conversationStore`; current `main` replaced it with PostgreSQL-backed `messageStore`.
- Keep Node.js `>=24 <25`, npm `>=11 <12`, and strict TypeScript checking.
- Preserve the TypeScript 7 compiler / TypeScript 6 lint-API compatibility arrangement until `typescript-eslint` supports the TypeScript 7 API.
- Tests must not contact Discord, PostgreSQL, Open WebUI, Ollama, Giphy, or any other external service.
- Keep generated `dist` output untracked.
- Do not identify a coding assistant, language model, or automation as a contributor or author.
- Replacing remote `main`, including force-pushing it, requires a separate explicit instruction after this plan is complete.

---

### Task 1: Record the migration ancestry without importing the obsolete tree

**Files:**

- Verify: `.git/MERGE_HEAD`
- Verify: branch `caitlyn-2.0`

**Interfaces:**

- Consumes: `caitlyn-2.0` at the current `main` tree plus the committed integration design.
- Produces: a two-parent merge commit whose second parent is `typescript-migration`, while the working tree remains the current ESM application.

- [ ] **Step 1: Verify the branch is clean and local**

Run:

```powershell
git status --short --branch
git branch --show-current
git branch -r --contains HEAD
```

Expected: the current branch is `caitlyn-2.0`, the working tree is clean, and no remote branch contains the design commits.

- [ ] **Step 2: Record the TypeScript branch as merged**

Run:

```powershell
git merge -s ours --no-edit typescript-migration
```

Expected: Git creates a merge commit without changing the ESM source tree. The `ours` strategy is intentional: later tasks port the useful migration work onto newer `main` behavior in reviewable commits.

- [ ] **Step 3: Verify both parents and the unchanged tree**

Run:

```powershell
git show --no-patch --format="%H%n%P%n%s" HEAD
git diff --exit-code HEAD^1 HEAD
git merge-base --is-ancestor typescript-migration HEAD
```

Expected: `HEAD` has two parents, the first-parent tree is unchanged, and `typescript-migration` is an ancestor of `caitlyn-2.0`.

---

### Task 2: Establish the ESM TypeScript toolchain and characterization harness

**Files:**

- Modify: `package.json`
- Regenerate: `package-lock.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Rename: `eslint.config.js` to `eslint.config.mjs`
- Create: `scripts/cleanDist.mjs`
- Create: `tests/currentMainModules.test.js`

**Interfaces:**

- Consumes: the Node.js ESM package from current `main`.
- Produces: `npm run dev`, `typecheck`, `lint`, `build`, `test`, and `check`; temporary JS source support for incremental conversion; a test inventory of all current command and event names.

- [ ] **Step 1: Add a characterization test for the current module inventory**

Create `tests/currentMainModules.test.js` with ESM imports and filesystem discovery:

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const expectedCommands = [
	"activity",
	"addbirthday",
	"leaderboard",
	"ping",
	"reload",
	"removebirthday",
	"server",
	"showbirthdays",
	"streaks",
	"toggleai",
	"user",
];
const expectedEvents = ["interactionCreate", "messageCreate", "ready", "voiceStateUpdate"];

async function exportedNames(root) {
	const files = fs.readdirSync(root).filter((file) => file.endsWith(".js"));
	return Promise.all(files.map(async (file) => {
		const module = await import(pathToFileURL(path.join(root, file)).href);
		return module.data?.name ?? path.basename(file, ".js");
	}));
}

test("current main exposes every command and event before conversion", async () => {
	const commandFolders = ["commands/user", "commands/utility"];
	const commands = (await Promise.all(commandFolders.map(exportedNames))).flat().sort();
	const events = (await exportedNames("events")).sort();
	assert.deepEqual(commands, expectedCommands);
	assert.deepEqual(events, expectedEvents);
});
```

- [ ] **Step 2: Run the characterization test against current JavaScript**

Run:

```powershell
node --test tests/currentMainModules.test.js
```

Expected: one test passes and proves the current command/event inventory before source conversion.

- [ ] **Step 3: Reconcile `package.json` as ESM TypeScript**

Keep all current production dependencies and use these exact package fields and scripts:

```json
{
	"version": "2.1.0",
	"type": "module",
	"main": "dist/main.js",
	"engines": {
		"node": ">=24 <25",
		"npm": ">=11 <12"
	},
	"scripts": {
		"build": "npm run clean && tsc -p tsconfig.build.json",
		"check": "npm run typecheck && npm run lint && npm run build && npm test",
		"clean": "node scripts/cleanDist.mjs",
		"deploy": "tsx core/deployCommands.ts",
		"deploy:prod": "node dist/core/deployCommands.js",
		"dev": "tsx main.ts",
		"dev:watch": "tsx watch main.ts",
		"lint": "eslint .",
		"start": "node dist/main.js",
		"test": "node --import tsx --test",
		"typecheck": "tsc --noEmit"
	}
}
```

Use the migration tool versions as the minimum resolved versions:

```json
{
	"@eslint/js": "^10.0.1",
	"@types/node": "^24.13.3",
	"@types/node-cron": "^3.0.11",
	"@types/pg": "^8.23.1",
	"@typescript/native": "npm:typescript@^7.0.2",
	"eslint": "^10.10.0",
	"tsx": "^4.23.13",
	"typescript": "npm:@typescript/typescript6@^6.0.2",
	"typescript-eslint": "^8.69.0"
}
```

- [ ] **Step 4: Add temporary incremental compiler configuration**

Create `tsconfig.json`:

```json
{
	"compilerOptions": {
		"allowJs": true,
		"checkJs": false,
		"esModuleInterop": true,
		"forceConsistentCasingInFileNames": true,
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"noEmit": true,
		"resolveJsonModule": true,
		"skipLibCheck": true,
		"strict": true,
		"target": "ES2024",
		"types": ["node"]
	},
	"include": [
		"commands/**/*",
		"core/**/*",
		"events/**/*",
		"handlers/**/*",
		"jobs/**/*",
		"messages/**/*",
		"scripts/**/*.ts",
		"types/**/*.ts",
		"main.*"
	],
	"exclude": ["dist", "node_modules"]
}
```

Create `tsconfig.build.json`:

```json
{
	"extends": "./tsconfig.json",
	"compilerOptions": {
		"noEmit": false,
		"outDir": "dist",
		"rootDir": ".",
		"sourceMap": true
	},
	"exclude": ["dist", "node_modules", "scripts", "tests"]
}
```

- [ ] **Step 5: Add the ESM clean-build helper**

Create `scripts/cleanDist.mjs`:

```js
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distPath = fileURLToPath(new URL("../dist", import.meta.url));
rmSync(distPath, { force: true, recursive: true });
```

- [ ] **Step 6: Install from the reconciled manifest and configure ESLint**

Run `npm install`, then replace the old ESLint config with the migration branch's TypeScript-aware flat config. Keep the established tab, double-quote, and semicolon rules; include `**/*.js`, `**/*.mjs`, and `**/*.ts`; ignore `dist/**` and `node_modules/**`.

Run:

```powershell
npm install
npx tsc --version
node -e "console.log(require('typescript').version)"
npm run typecheck
```

Expected: the compiler is TypeScript 7.0.2, the parser API is TypeScript 6.x, and incremental typecheck passes.

- [ ] **Step 7: Commit the ESM toolchain**

```powershell
git add package.json package-lock.json tsconfig.json tsconfig.build.json eslint.config.mjs scripts/cleanDist.mjs tests/currentMainModules.test.js
git commit -m "build: add ESM TypeScript toolchain"
```

---

### Task 3: Convert shared types and core services

**Files:**

- Create: `types/environment.d.ts`
- Create: `types/models.ts`
- Rename: `core/createClient.js` to `core/createClient.ts`
- Rename: `core/createPGPool.js` to `core/createPGPool.ts`
- Rename: `core/loginClient.js` to `core/loginClient.ts`
- Rename: `core/logger.js` to `core/logger.ts`
- Rename: `core/aiState.js` to `core/aiState.ts`
- Rename: `core/embeddingService.js` to `core/embeddingService.ts`
- Rename: `core/messageStore.js` to `core/messageStore.ts`
- Rename: `core/ollama.js` to `core/ollama.ts`
- Create: `tests/coreServices.test.js`
- Create: `tests/environmentLoading.test.js`
- Create: `tests/messageStore.test.js`

**Interfaces:**

- Produces: typed ESM exports `createClient`, `pool`, `createPGPool`, `loginClient`, `logger`, AI state functions, `generateEmbedding`, `generateEmbeddings`, message-store functions, and `chat`.
- Consumes: current `main` SQL, Open WebUI payloads, vector formats, and logging behavior without changing them.

- [ ] **Step 1: Write direct-import and service behavior tests**

The tests must import `.ts` paths and assert these observable contracts:

```js
test("PostgreSQL initialization probes SELECT NOW without opening a real service", async () => {});
test("AI state honors LLM_ENABLED and toggles in memory", async () => {});
test("embedding requests preserve endpoint, model, and response vector", async () => {});
test("Open WebUI chat preserves auth, chat_id, and reply normalization", async () => {});
test("message storage preserves vector SQL and context ordering", async () => {});
test("core configuration loads from .env on direct import", async () => {});
```

Use a temporary working directory and child process for `.env` assertions. Add optional final dependency arguments to network functions so tests pass a fake `fetch` without replacing globals:

```ts
export interface FetchDependencies {
	fetch: typeof globalThis.fetch;
}

export async function generateEmbedding(
	text: string,
	dependencies: FetchDependencies = { fetch: globalThis.fetch },
): Promise<number[]>;

export async function chat(
	messages: ChatMessage[],
	chatId: string | null = null,
	dependencies: FetchDependencies = { fetch: globalThis.fetch },
): Promise<string | undefined>;
```

- [ ] **Step 2: Run tests to capture the missing TypeScript modules**

Run:

```powershell
node --import tsx --test tests/coreServices.test.js tests/environmentLoading.test.js tests/messageStore.test.js
```

Expected: tests fail with module-not-found errors for the planned `.ts` paths.

- [ ] **Step 3: Define environment and model contracts**

Create `types/environment.d.ts` with these fields:

```ts
declare namespace NodeJS {
	interface ProcessEnv {
		CLIENT_ID: string;
		CONTEXT_RECENT_COUNT: string;
		CONTEXT_SIMILAR_COUNT: string;
		EMBEDDING_ENDPOINT: string;
		EMBEDDING_MODEL: string;
		GENERAL_CHAT_ID: string;
		GIPHY_API_KEY: string;
		GUILD_ID: string;
		LLM_ENABLED?: "true" | "false";
		LOG_LEVEL?: "DEBUG" | "INFO" | "WARN" | "ERROR";
		OLLAMA_MODEL: string;
		PGDATABASE: string;
		PGHOST: string;
		PGPASSWORD: string;
		PGPORT: string;
		PGUSER: string;
		TOKEN: string;
		WEBUI_API_KEY: string;
		WEBUI_CHAT_ENDPOINT: string;
	}
}
```

Create `types/models.ts` with exported `ChatMessage`, `OpenWebUIResponse`, `EmbeddingResponse`, `StoredMessage`, `MessageContext`, `VoiceSession`, and `ActivityRow` interfaces matching the current SQL and JSON field names.

- [ ] **Step 4: Rename and type the core modules**

Use `git mv` for all eight modules. Keep named ESM exports and `.js` import specifiers. Use these public signatures:

```ts
export function createClient(intents: GatewayIntentBits[]): Client;
export async function createPGPool(): Promise<void>;
export function loginClient(client: Client): Promise<string>;
export function isAIEnabled(): boolean;
export function enableAI(): boolean;
export function disableAI(): boolean;
export function toggleAI(): boolean;
export function resetAIState(): void;
export async function storeMessage(input: StoreMessageInput): Promise<number>;
export async function searchSimilarMessages(input: SimilarMessageQuery): Promise<StoredMessage[]>;
export async function getRecentMessages(channelId: string, limit?: number): Promise<StoredMessage[]>;
export async function getConversationContext(input: ContextQuery): Promise<MessageContext[]>;
export async function clearOldMessages(channelId: string, daysToKeep?: number): Promise<number>;
```

Each module that captures environment configuration must begin with `import "dotenv/config";`. Preserve current `main` error logging and return behavior.

- [ ] **Step 5: Run focused and compiler verification**

```powershell
node --import tsx --test tests/coreServices.test.js tests/environmentLoading.test.js tests/messageStore.test.js
npm run typecheck
git diff --check
```

Expected: focused tests and strict typecheck pass.

- [ ] **Step 6: Commit typed core services**

```powershell
git add core types tests/coreServices.test.js tests/environmentLoading.test.js tests/messageStore.test.js
git commit -m "refactor: type ESM core services"
```

---

### Task 4: Convert loaders, deployment, and startup

**Files:**

- Create: `types/command.ts`
- Create: `types/event.ts`
- Create: `types/discord.d.ts`
- Rename: `handlers/commandHandler.js` to `handlers/commandHandler.ts`
- Rename: `handlers/eventHandler.js` to `handlers/eventHandler.ts`
- Rename: `handlers/cronJobHandler.js` to `handlers/cronJobHandler.ts`
- Rename: `core/deployCommands.js` to `core/deployCommands.ts`
- Rename: `main.js` to `main.ts`
- Create: `tests/loaders.test.js`
- Create: `tests/startup.test.js`

**Interfaces:**

- Produces: typed `commandHandler`, `eventHandler`, `startCronJobs`, deployment entry point, and `startBot`.
- Consumes: named ESM command/event exports and current logger/core services.

- [ ] **Step 1: Add failing source-runtime loader tests**

Create tests that use temporary module roots and assert:

```js
test("command loader imports only the current .ts runtime extension", async () => {});
test("event loader imports only the current .ts runtime extension", async () => {});
test("startup preserves initialization order and required Discord intents", async () => {});
test("deployment rejects missing TOKEN, CLIENT_ID, or GUILD_ID", async () => {});
```

Run:

```powershell
node --import tsx --test tests/loaders.test.js tests/startup.test.js
```

Expected: `.ts` loader and startup-import tests fail before the files are converted.

- [ ] **Step 2: Define named-export module contracts**

Create `types/command.ts`:

```ts
import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";

export interface BotCommand {
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
	category: string;
	cooldown?: number;
	data: {
		readonly name: string;
		toJSON(): ReturnType<SlashCommandBuilder["toJSON"]>;
	};
	execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
}

export function isBotCommand(value: unknown): value is BotCommand;
```

Create `types/event.ts` with the Discord event tuple preserved by key:

```ts
import type { ClientEvents } from "discord.js";

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
	execute: (...args: ClientEvents[K]) => Promise<unknown> | unknown;
	name: K;
	once?: boolean;
}
```

Augment `discord.js` in `types/discord.d.ts` so `Client.commands` is `Collection<string, BotCommand>`.

- [ ] **Step 3: Implement runtime-aware ESM loaders**

Both handlers accept an optional root for deterministic tests and default to the production folder:

```ts
export async function commandHandler(
	client: Client,
	commandsRoot = fileURLToPath(new URL("../commands", import.meta.url)),
): Promise<void>;

export async function eventHandler(
	client: Client,
	eventsRoot = fileURLToPath(new URL("../events", import.meta.url)),
): Promise<void>;
```

Derive the runtime extension with `path.extname(fileURLToPath(import.meta.url))`, build file URLs with `pathToFileURL`, and store the imported module namespace after validating it with `isBotCommand` or the event guard.

- [ ] **Step 4: Convert deployment and startup without import side effects**

Export `startBot` with injectable defaults for tests and retain a direct-entry guard:

```ts
export async function startBot(dependencies: StartBotDependencies = defaultDependencies): Promise<void>;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void startBot();
}
```

Preserve current `main` order: create client, initialize PostgreSQL, load commands/events, start cron jobs, then log in. Preserve uncaught exception, rejection, SIGTERM, and SIGINT handling for direct execution.

- [ ] **Step 5: Verify and commit**

```powershell
node --import tsx --test tests/loaders.test.js tests/startup.test.js
npm run typecheck
git diff --check
git add handlers core/deployCommands.ts main.ts types tests/loaders.test.js tests/startup.test.js
git commit -m "refactor: type ESM application loading"
```

---

### Task 5: Convert AI, social-message, and event flows

**Files:**

- Rename: `messages/caitlynAI.js` to `messages/caitlynAI.ts`
- Rename: `messages/socialMediaMessage.js` to `messages/socialMediaMessage.ts`
- Rename: `messages/twitterVideoMessage.js` to `messages/twitterVideoMessage.ts`
- Rename: `messages/birthdayReminderMessage.js` to `messages/birthdayReminderMessage.ts`
- Rename: `handlers/messageHandler.js` to `handlers/messageHandler.ts`
- Rename: `events/interactionCreate.js` to `events/interactionCreate.ts`
- Rename: `events/messageCreate.js` to `events/messageCreate.ts`
- Rename: `events/ready.js` to `events/ready.ts`
- Rename: `events/voiceStateUpdate.js` to `events/voiceStateUpdate.ts`
- Create: `tests/caitlynAI.test.js`
- Create: `tests/messageHandler.test.js`
- Create: `tests/socialMediaMessage.test.js`
- Create: `tests/events.test.js`

**Interfaces:**

- Produces: typed event modules and message functions preserving current Open WebUI/vector-memory/activity behavior.
- Consumes: typed core services and Discord client augmentation.

- [ ] **Step 1: Write behavior tests before renaming**

Add tests for:

```js
test("AI-disabled messages skip context, chat, storage, and replies", async () => {});
test("AI replies use vector context and store both user and assistant messages", async () => {});
test("AI errors send the existing user-facing fallback", async () => {});
test("message handling tracks guild activity before starting overlapping AI and social work", async () => {});
test("message handling awaits both AI and social operations in either settlement order", async () => {});
test("supported social URLs are replaced and unsupported messages remain untouched", async () => {});
test("voice moves record leave before join while bot users are ignored", async () => {});
test("interaction dispatch preserves autocomplete and command error responses", async () => {});
```

Use optional dependency objects on `caitlynAI`, `messageHandler`, and voice event execution. Defaults point to the real imported services, so Discord still calls each function with one argument.

- [ ] **Step 2: Run the `.ts` import tests and observe failure**

```powershell
node --import tsx --test tests/caitlynAI.test.js tests/messageHandler.test.js tests/socialMediaMessage.test.js tests/events.test.js
```

Expected: imports fail because the runtime modules still have `.js` source filenames.

- [ ] **Step 3: Rename and type message modules**

Keep `.js` specifiers and current named exports. Use these signatures:

```ts
export async function caitlynAI(
	message: Message,
	dependencies: CaitlynAIDependencies = defaultCaitlynAIDependencies,
): Promise<void>;

export async function messageHandler(
	message: Message,
	dependencies: MessageHandlerDependencies = defaultMessageHandlerDependencies,
): Promise<void>;

export async function socialMediaMessage(message: Message): Promise<void>;
export async function twitterVideoMessage(message: Message): Promise<void>;
export async function birthdayReminderMessage(client: Client): Promise<void>;
```

After activity tracking, start AI and social handling in the observed order and await both:

```ts
const aiOperation = dependencies.caitlynAI(message);
const socialOperation = dependencies.socialMediaMessage(message);
await Promise.all([aiOperation, socialOperation]);
```

- [ ] **Step 4: Rename and type all four event modules**

Use Discord.js `Events`, `Interaction`, `Message`, `Client<true>`, and `VoiceState` types. Each event remains a named ESM module with `name`, optional `once`, and `execute` exports.

- [ ] **Step 5: Verify and commit**

```powershell
node --import tsx --test tests/caitlynAI.test.js tests/messageHandler.test.js tests/socialMediaMessage.test.js tests/events.test.js
npm run typecheck
git diff --check
git add messages handlers/messageHandler.ts events tests
git commit -m "refactor: type message and event flows"
```

---

### Task 6: Convert activity tracking and activity commands

**Files:**

- Rename: `core/activityTracker.js` to `core/activityTracker.ts`
- Rename: `commands/user/activity.js` to `commands/user/activity.ts`
- Rename: `commands/utility/leaderboard.js` to `commands/utility/leaderboard.ts`
- Rename: `commands/utility/streaks.js` to `commands/utility/streaks.ts`
- Rename: `commands/utility/toggleai.js` to `commands/utility/toggleai.ts`
- Create: `tests/activityTracker.test.js`
- Create: `tests/activityCommands.test.js`

**Interfaces:**

- Produces: typed activity SQL functions, duration formatting, and four newer command modules.
- Consumes: `ActivityRow`, `VoiceSession`, `pool`, AI state, logger, and the named command-module contract.

- [ ] **Step 1: Add SQL, clock, and command-output tests**

```js
test("message activity records count and daily activity in order", async () => {});
test("voice join stores the returned session and voice leave records elapsed seconds", async () => {});
test("missing voice sessions keep the existing warning behavior", async () => {});
test("formatDuration preserves hour, minute, second formatting", () => {});
test("activity command renders counts, averages, and streak fields", async () => {});
test("leaderboard and streak commands preserve ordering and empty states", async () => {});
test("toggleai preserves administrator metadata and ephemeral response", async () => {});
```

Supply an optional `ActivityTrackerDependencies` object containing `query`, `now`, and `sessions`. Use a fresh `Map` per test and a fixed clock.

- [ ] **Step 2: Run tests before conversion**

```powershell
node --import tsx --test tests/activityTracker.test.js tests/activityCommands.test.js
```

Expected: tests fail on missing `.ts` modules.

- [ ] **Step 3: Rename modules and apply exact public signatures**

```ts
export async function trackMessage(guildId: string, userId: string, username: string, dependencies?: ActivityTrackerDependencies): Promise<void>;
export async function trackVoiceJoin(guildId: string, userId: string, username: string, channelId: string, channelName: string, dependencies?: ActivityTrackerDependencies): Promise<void>;
export async function trackVoiceLeave(guildId: string, userId: string, username: string, dependencies?: ActivityTrackerDependencies): Promise<void>;
export async function getUserActivity(guildId: string, userId: string): Promise<ActivityRow | null>;
export async function getTopActiveUsers(guildId: string, limit?: number): Promise<ActivityRow[]>;
export async function getTopStreakUsers(guildId: string, limit?: number): Promise<ActivityRow[]>;
export function formatDuration(seconds: number): string;
```

Keep every SQL string and error-return policy from current `main`. Type the commands with `ChatInputCommandInteraction` and preserve all embed fields, colors, cooldowns, and replies.

- [ ] **Step 4: Verify and commit**

```powershell
node --import tsx --test tests/activityTracker.test.js tests/activityCommands.test.js
npm run typecheck
git diff --check
git add core/activityTracker.ts commands/user/activity.ts commands/utility/leaderboard.ts commands/utility/streaks.ts commands/utility/toggleai.ts tests
git commit -m "refactor: type activity features"
```

---

### Task 7: Convert birthday and remaining utility commands

**Files:**

- Rename: `commands/user/addbirthday.js` to `commands/user/addbirthday.ts`
- Rename: `commands/user/removebirthday.js` to `commands/user/removebirthday.ts`
- Rename: `commands/user/showbirthdays.js` to `commands/user/showbirthdays.ts`
- Rename: `commands/utility/ping.js` to `commands/utility/ping.ts`
- Rename: `commands/utility/reload.js` to `commands/utility/reload.ts`
- Rename: `commands/utility/server.js` to `commands/utility/server.ts`
- Rename: `commands/utility/user.js` to `commands/utility/user.ts`
- Rename: `jobs/birthdayScheduledEvent.js` to `jobs/birthdayScheduledEvent.ts`
- Create: `tests/birthdayBehavior.test.js`
- Create: `tests/utilityCommands.test.js`

**Interfaces:**

- Produces: a fully TypeScript command/job tree with named ESM exports and runtime-aware reload behavior.
- Consumes: `BotCommand`, PostgreSQL pool, birthday message function, cron, logger, and Discord.js interactions.

- [ ] **Step 1: Add execution-level command tests**

```js
test("birthday commands preserve insert, update, delete, and duplicate SQL paths", async () => {});
test("showbirthdays preserves deferred reply and deterministic embed grouping", async () => {});
test("birthday scheduling registers 0 9 * * * and dispatches the reminder", async () => {});
test("utility command metadata preserves ping, reload, server, and user", async () => {});
test("reload replaces the selected command through a cache-busted ESM URL", async () => {});
test("reload autocomplete lowercases matching and caps choices at 25", async () => {});
```

Freeze the clock for birthday tests and reset it in `finally`. Pass fake query/fetch/scheduler/import dependencies rather than contacting services.

- [ ] **Step 2: Run tests before the `.ts` modules exist**

```powershell
node --import tsx --test tests/birthdayBehavior.test.js tests/utilityCommands.test.js
```

Expected: tests fail on missing TypeScript command/job paths.

- [ ] **Step 3: Rename and type birthday/utility modules**

Preserve named exports:

```ts
export const cooldown = 5;
export const category = "user";
export const data = new SlashCommandBuilder();
export async function execute(interaction: ChatInputCommandInteraction): Promise<void>;
```

Use category `user` and cooldown `5` for `addbirthday` and `removebirthday`; use category `user` with no newly introduced cooldown for `showbirthdays`. Use category `utility` with cooldown `5` for `ping`, `server`, and `user`; keep `reload` in category `utility` without introducing a cooldown. Do not replace current `main` SQL, MessageFlags, embed copy, or validation.

For `/reload`, derive `.ts` or `.js` from `import.meta.url`, build the selected command path from `loadedCommand.category` and `loadedCommand.data.name`, and add a unique query parameter to `pathToFileURL(commandPath).href` before dynamic import.

- [ ] **Step 4: Verify that no runtime JavaScript remains**

Run:

```powershell
rg --files commands core events handlers jobs messages -g "*.js"
```

Expected: no output.

Run focused tests and typecheck:

```powershell
node --import tsx --test tests/birthdayBehavior.test.js tests/utilityCommands.test.js
npm run typecheck
git diff --check
```

- [ ] **Step 5: Commit the completed runtime conversion**

```powershell
git add commands jobs tests tsconfig.json
git commit -m "refactor: complete ESM TypeScript runtime"
```

---

### Task 8: Convert operational scripts and align documentation

**Files:**

- Rename: `scripts/checkMessages.js` to `scripts/checkMessages.ts`
- Rename: `scripts/runMigration.js` to `scripts/runMigration.ts`
- Rename: `scripts/testContext.js` to `scripts/testContext.ts`
- Rename: `scripts/testMemory.js` to `scripts/testMemory.ts`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `.todo`
- Create: `docs/development.md`
- Create: `tests/operationalScripts.test.js`

**Interfaces:**

- Produces: typed operational tools, accurate setup instructions, and the branch policy for future work.
- Consumes: the typed core ESM services and current SQL migration directory.

- [ ] **Step 1: Add import-safe script tests**

```js
test("migration runner resolves migrations from the repository directory", async () => {});
test("diagnostic scripts import typed core services without executing on import", async () => {});
```

Add a direct-entry guard to every operational script:

```ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	void run();
}
```

Run tests before renaming and expect `.ts` import failures.

- [ ] **Step 2: Rename and type the four scripts**

Keep existing SQL, output, exit codes, and file resolution. Type caught errors with `unknown` and narrow them before accessing `.message`.

- [ ] **Step 3: Update setup and branch documentation**

Update `README.md` to use:

```text
npm ci
npm run dev
npm run check
npm run build
npm start
```

Document Node.js 24/npm 11, compiled `dist`, Open WebUI/vector-memory variables, and migrations `001` through `008`.

Create `docs/development.md` with this branch rule:

```markdown
## Branch base

Until Caitlyn 2.0 is promoted, create feature branches from `caitlyn-2.0`.
Do not target or update `main` without an explicit release decision because pushes to `main` deploy to the homeserver.
```

- [ ] **Step 4: Reconcile migration tracking without overstating work**

Keep current completed feature history. Add a Caitlyn 2.0 modernization section that marks the ESM TypeScript conversion, Node.js 24 toolchain, tests, lint, clean build, Docker, and CI gate complete only after their relevant tasks pass. Leave production dependency auditing, `node-cron` v4, `node-fetch` removal, and any unimplemented environment hardening unchecked.

- [ ] **Step 5: Verify and commit**

```powershell
node --import tsx --test tests/operationalScripts.test.js
npm run typecheck
git diff --check
git add scripts README.md .env.example .todo docs/development.md tests/operationalScripts.test.js
git commit -m "docs: align Caitlyn 2.0 operations"
```

---

### Task 9: Enforce lint, production output, Docker, and CI

**Files:**

- Modify: `eslint.config.mjs`
- Modify: `tsconfig.json`
- Create: `tests/buildOutput.test.js`
- Create: `.dockerignore`
- Modify: `Dockerfile`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Produces: a JavaScript-free runtime source tree, lint-clean ESM TypeScript, hermetic `dist`, a Node.js 24 image, and pre-publication CI checks.
- Consumes: all converted modules and the `npm run check` quality gate.

- [ ] **Step 1: Remove temporary JavaScript compiler support**

After confirming runtime source is TypeScript, remove:

```json
"allowJs": true,
"checkJs": false
```

Keep operational `.ts` scripts in typecheck and excluded from production build.

- [ ] **Step 2: Run lint and fix only reported violations**

```powershell
npm run lint
```

Fix reported files while retaining tabs, double quotes, semicolons, current comments, SQL, and responses. Do not apply unrelated refactors. Re-run until exit code 0.

- [ ] **Step 3: Add the complete ESM output contract**

Create `tests/buildOutput.test.js` and assert these files exist after a clean build:

```js
const expectedFiles = [
	"dist/main.js",
	"dist/core/deployCommands.js",
	"dist/events/interactionCreate.js",
	"dist/events/messageCreate.js",
	"dist/events/ready.js",
	"dist/events/voiceStateUpdate.js",
	"dist/commands/user/activity.js",
	"dist/commands/user/addbirthday.js",
	"dist/commands/user/removebirthday.js",
	"dist/commands/user/showbirthdays.js",
	"dist/commands/utility/leaderboard.js",
	"dist/commands/utility/ping.js",
	"dist/commands/utility/reload.js",
	"dist/commands/utility/server.js",
	"dist/commands/utility/streaks.js",
	"dist/commands/utility/toggleai.js",
	"dist/commands/utility/user.js",
];
```

Plant `dist/stale.js`, run `npm run build`, and assert the sentinel is removed before running the output test. Also dynamically import `dist/main.js` and one command/event module without starting the bot.

- [ ] **Step 4: Update Docker for the ESM build**

Use Node.js 24 Alpine stages. The build stage copies package manifests, TypeScript configs, `scripts/cleanDist.mjs`, `types`, and all runtime source directories, then runs typecheck and build. The runtime stage installs `npm ci --omit=dev`, copies only `dist`, and uses:

```dockerfile
CMD ["sh", "-c", "npm run deploy:prod && npm start"]
```

Use `.dockerignore` entries:

```text
.env
.git
.github
dist
docs
node_modules
npm-debug.log*
tests
```

- [ ] **Step 5: Preserve deployment scope while updating CI**

Keep the existing `push: branches: [main]` trigger and both existing GHCR tags. Use:

```yaml
- uses: actions/checkout@v6
- uses: actions/setup-node@v6
  with:
    node-version: 24
    cache: npm
- name: Install dependencies
  run: npm ci
- name: Check TypeScript application
  run: npm run check
```

Keep registry login and `docker/build-push-action@v7` after the quality gate.

- [ ] **Step 6: Run production verification**

```powershell
npm run check
docker build --tag caitlyn:2.0-integration .
git diff --check
git ls-files -- dist
```

Expected: the quality gate passes and `git ls-files -- dist` prints nothing. If Docker is missing or its daemon is unavailable, record the exact error and do not claim a local image passed.

- [ ] **Step 7: Commit production integration**

```powershell
git add eslint.config.mjs tsconfig.json tests/buildOutput.test.js .dockerignore Dockerfile .github/workflows/ci.yml package.json package-lock.json
git commit -m "build: verify Caitlyn 2.0 production output"
```

---

### Task 10: Review the complete integration and preserve the local branch

**Files:**

- Review: every file changed from `8050685` to `HEAD`
- Verify: branch `caitlyn-2.0`

**Interfaces:**

- Consumes: the complete ESM TypeScript integration.
- Produces: a reviewed, locally preserved feature base with no push or deployment side effect.

- [ ] **Step 1: Install from the lockfile**

```powershell
npm ci
npx tsc --version
node -e "console.log(require('typescript').version)"
```

Expected: clean install succeeds, compiler reports TypeScript 7.0.2, and the parser API reports TypeScript 6.x.

- [ ] **Step 2: Run the complete local gate**

```powershell
npm run check
```

Expected: typecheck, lint, clean ESM build, and all tests pass with zero failures.

- [ ] **Step 3: Perform branch-level review**

Review:

```powershell
git diff --stat 8050685..HEAD
git diff --check 8050685..HEAD
git log --graph --oneline --decorate 8050685..HEAD
git merge-base --is-ancestor typescript-migration HEAD
rg --files commands core events handlers jobs messages -g "*.js"
git ls-files -- dist
git status --short --branch
```

Expected: migration ancestry is present, runtime JS inventory and tracked `dist` are empty, the branch is clean, and every critical/important review finding is resolved.

- [ ] **Step 4: Confirm deployment isolation**

```powershell
git branch -r --contains HEAD
git status --short --branch
```

Expected: no remote branch contains `HEAD`; nothing has been pushed and the `main`-triggered homeserver pipeline has not been invoked.

- [ ] **Step 5: Leave the integration branch in place**

Do not merge into `main`, do not delete `typescript-migration`, and do not push. Report that future feature work begins by returning to the integration base:

```powershell
git switch caitlyn-2.0
```

Create the next feature branch only after the user supplies its exact name.

---
