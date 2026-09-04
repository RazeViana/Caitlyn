# TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Caitlyn to a typed Node.js 24 application while preserving every current user-visible feature and the existing code organization and style.

**Architecture:** Source remains organized under the existing `commands`, `core`, `events`, `handlers`, `jobs`, and `messages` folders. TypeScript uses Node-aware module resolution and emits CommonJS-compatible JavaScript into `dist`; `tsx` runs source during development, while production runs compiled JavaScript with Node.js.

**Tech Stack:** Node.js 24 LTS, TypeScript, tsx, Discord.js, PostgreSQL (`pg`), Node's built-in test runner, ESLint flat configuration, Docker, and GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-typescript-migration-design.md`

## Global Constraints

- Target Node.js 24 LTS.
- Use `.ts` for source files; there is no JSX and no `.tsx` source is needed.
- Preserve CommonJS-compatible runtime behavior so dynamic command/event loading and `/reload` continue to work.
- Preserve the current directory structure, command names, response text, database queries, schedules, environment variable names, and external API behavior.
- Preserve tabs, double quotes, semicolons, and the existing documentation-comment style.
- Do not add activity tracking, redesign the Ollama integration, or perform a full ESM conversion.
- Never identify an AI system as a contributor or author in project history or artifacts.

---

## File Structure

**New files**

- `tsconfig.json`: strict type-checking configuration shared by development and tests.
- `tsconfig.build.json`: production emit configuration targeting `dist`.
- `types/command.ts`: command-module interface used by the command loader and interaction event.
- `types/event.ts`: event-module interface used by the event loader.
- `types/models.ts`: Ollama conversation and birthday-row data shapes.
- `types/environment.d.ts`: required and optional environment variable declarations.
- `types/discord.d.ts`: Discord `Client` augmentation for commands and cooldowns.
- `tests/conversationStore.test.js`: characterization tests for conversation storage.
- `tests/ollama.test.js`: characterization test for the Ollama request and response contract.
- `tests/socialMediaMessage.test.js`: characterization tests for social-link replacement.
- `tests/loaders.test.js`: source loader regression tests.
- `tests/buildOutput.test.js`: compiled-module presence checks.
- `.dockerignore`: excludes local and development-only files from Docker build context.

**Renamed files**

- `main.js` to `main.ts`.
- Every application `.js` file under `commands`, `core`, `events`, `handlers`, `jobs`, and `messages` to the same path with a `.ts` suffix.
- `eslint.config.js` to `eslint.config.mjs` so Node loads the flat configuration as ESM without changing application module behavior.

**Modified files**

- `package.json` and `package-lock.json`: runtime declaration, scripts, and TypeScript/lint dependencies.
- `Dockerfile`: Node.js 24 multi-stage TypeScript build.
- `.github/workflows/ci.yml`: typecheck, lint, test, and build gates before image publication.
- `.gitignore`: emitted `dist` remains ignored.
- `.todo`: record completed migration work and leave unrelated modernization work open.

---

### Task 1: Capture current behavior with characterization tests

**Files:**

- Create: `tests/conversationStore.test.js`
- Create: `tests/ollama.test.js`
- Create: `tests/socialMediaMessage.test.js`
- Modify: `package.json:6-10`

**Interfaces:**

- Consumes: `getConversation(key)`, `addMessage(key, role, content)`, `resetConversation(key)`, and `socialMediaMessage(message)` exactly as currently exported.
- Produces: a passing `npm test` baseline for memory, social links, and Ollama requests that later conversion tasks must preserve.

- [ ] **Step 1: Add conversation-store characterization tests**

Create `tests/conversationStore.test.js`:

```js
const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

process.env.CONVERSATION_MEMORY_SIZE = "2";

const {
	addMessage,
	getConversation,
	resetConversation,
} = require("../core/conversationStore.js");

const keys = [];

afterEach(() => {
	for (const key of keys.splice(0)) {
		resetConversation(key);
	}
});

test("creates an empty conversation for a new key", () => {
	const key = "new-conversation";
	keys.push(key);

	assert.deepEqual(getConversation(key), []);
});

test("keeps only the configured number of recent messages", () => {
	const key = "bounded-conversation";
	keys.push(key);

	addMessage(key, "user", "first");
	addMessage(key, "assistant", "second");
	addMessage(key, "user", "third");

	assert.deepEqual(getConversation(key), [
		{ role: "assistant", content: "second" },
		{ role: "user", content: "third" },
	]);
});
```

- [ ] **Step 2: Add social-link characterization tests**

Create `tests/socialMediaMessage.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { socialMediaMessage } = require("../messages/socialMediaMessage.js");

function createMessage(content) {
	const sent = [];
	let deleted = false;

	return {
		message: {
			content,
			async delete() {
				deleted = true;
			},
			channel: {
				async send(value) {
					sent.push(value);
				},
			},
		},
		wasDeleted: () => deleted,
		sent,
	};
}

test("replaces a supported social URL and deletes the original", async () => {
	const fixture = createMessage("https://x.com/example/status/123");

	await socialMediaMessage(fixture.message);

	assert.equal(fixture.wasDeleted(), true);
	assert.deepEqual(fixture.sent, [
		"[x.com](https://twitterez.com/example/status/123)",
	]);
});

test("leaves unsupported messages untouched", async () => {
	const fixture = createMessage("hello there");

	await socialMediaMessage(fixture.message);

	assert.equal(fixture.wasDeleted(), false);
	assert.deepEqual(fixture.sent, []);
});
```

- [ ] **Step 3: Add the Ollama request characterization test**

Create `tests/ollama.test.js`:

```js
const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

process.env.OLLAMA_CHAT_ENDPOINT = "http://ollama.test/api/chat";
process.env.OLLAMA_MODEL = "caitlyn-test";

const originalFetch = global.fetch;
const { chat } = require("../core/ollama.js");

afterEach(() => {
	global.fetch = originalFetch;
});

test("sends conversation history to Ollama and returns its reply", async () => {
	let request;
	global.fetch = async (url, options) => {
		request = { url, options };
		return {
			async json() {
				return { message: { content: "Hello from Caitlyn" } };
			},
		};
	};

	const reply = await chat([{ role: "user", content: "Hello" }]);

	assert.equal(reply, "Hello from Caitlyn");
	assert.equal(request.url, "http://ollama.test/api/chat");
	assert.deepEqual(JSON.parse(request.options.body), {
		model: "caitlyn-test",
		messages: [{ role: "user", content: "Hello" }],
		stream: false,
	});
});
```

- [ ] **Step 4: Replace the placeholder test script**

Change the `scripts.test` value in `package.json` to:

```json
"test": "node --test"
```

- [ ] **Step 5: Run the baseline tests**

Run: `npm test`

Expected: 5 tests pass and 0 tests fail.

- [ ] **Step 6: Commit the baseline**

```bash
git add package.json tests/conversationStore.test.js tests/ollama.test.js tests/socialMediaMessage.test.js
git commit -m "test: capture current bot behavior"
```

---

### Task 2: Add the TypeScript development and build toolchain

**Files:**

- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `types/environment.d.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: the existing source tree and npm package metadata.
- Produces: `npm run dev`, `npm run dev:watch`, `npm run typecheck`, and `npm run build`; source JavaScript remains runnable during the incremental conversion.

- [ ] **Step 1: Install the TypeScript dependencies**

Run:

```bash
npm install --save-dev typescript tsx @types/node@24 @types/pg @types/node-cron discord-api-types
```

Expected: `package.json` and `package-lock.json` include all six development dependencies.

- [ ] **Step 2: Add strict type-checking configuration with temporary JavaScript support**

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
		"commands/**/*.ts",
		"core/**/*.ts",
		"events/**/*.ts",
		"handlers/**/*.ts",
		"jobs/**/*.ts",
		"messages/**/*.ts",
		"types/**/*.ts",
		"main.ts"
	],
	"exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Add production emit configuration**

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
	"exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 4: Declare the environment contract without adding runtime validation**

Create `types/environment.d.ts`:

```ts
declare namespace NodeJS {
	interface ProcessEnv {
		CLIENT_ID: string;
		CONVERSATION_MEMORY_SIZE: string;
		GENERAL_CHAT_ID: string;
		GIPHY_API_KEY: string;
		GUILD_ID: string;
		LLM_ENABLED?: "true" | "false";
		OLLAMA_CHAT_ENDPOINT: string;
		OLLAMA_MODEL: string;
		SYSTEM_PROMPT: string;
		TOKEN: string;
	}
}
```

- [ ] **Step 5: Add development, type-checking, and build scripts**

Set the relevant `package.json` fields to:

```json
"main": "dist/main.js",
"engines": {
	"node": ">=24 <25",
	"npm": ">=11 <12"
},
"scripts": {
	"build": "tsc -p tsconfig.build.json",
	"deploy": "tsx core/deployCommands.ts",
	"deploy:prod": "node dist/core/deployCommands.js",
	"dev": "tsx main.ts",
	"dev:watch": "tsx watch main.ts",
	"start": "node dist/main.js",
	"test": "node --test",
	"typecheck": "tsc --noEmit"
}
```

- [ ] **Step 6: Verify the toolchain before converting source**

Run: `npm test`

Expected: 5 tests pass.

Run: `npm run typecheck`

Expected: exits successfully; no `.ts` application files exist yet.

- [ ] **Step 7: Commit the toolchain**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.build.json types/environment.d.ts
git commit -m "build: add TypeScript toolchain"
```

---

### Task 3: Convert shared models and core services

**Files:**

- Create: `types/models.ts`
- Rename: `core/conversationStore.js` to `core/conversationStore.ts`
- Rename: `core/createClient.js` to `core/createClient.ts`
- Rename: `core/createPGPool.js` to `core/createPGPool.ts`
- Rename: `core/loginClient.js` to `core/loginClient.ts`
- Rename: `core/ollama.js` to `core/ollama.ts`
- Modify: `tests/conversationStore.test.js`
- Modify: `tests/ollama.test.js`

**Interfaces:**

- Produces: `ChatMessage`, `ChatRole`, `BirthdayRow`, `getConversation(key): ChatMessage[]`, `addMessage(key, role, content): void`, `resetConversation(key): void`, `createClient(intents): Client`, `createPGPool(): Promise<void>`, `pool: Pool`, `loginClient(client): void`, and `chat(messages): Promise<string>`.
- Consumes: environment declarations from Task 2 and existing Discord/PostgreSQL/Ollama behavior.

- [ ] **Step 1: Point the conversation tests at the future TypeScript source**

Change the import in `tests/conversationStore.test.js` to:

```js
} = require("../core/conversationStore.ts");
```

Change `scripts.test` in `package.json` to:

```json
"test": "node --import tsx --test"
```

Run: `npm test`

Expected: FAIL because `core/conversationStore.ts` does not exist.

- [ ] **Step 2: Add shared data models**

Create `types/models.ts`:

```ts
export type ChatRole = "assistant" | "system" | "user";

export interface ChatMessage {
	content: string;
	role: ChatRole;
}

export interface BirthdayRow {
	discord_id: string;
	dob: Date;
	name: string;
}

export interface OllamaChatResponse {
	message: {
		content: string;
	};
}
```

- [ ] **Step 3: Rename and type the conversation store**

Run: `git mv core/conversationStore.js core/conversationStore.ts`

Use these declarations while retaining the existing function bodies and exports:

```ts
import type { ChatMessage, ChatRole } from "../types/models.js";

const conversationMap = new Map<string, ChatMessage[]>();
const CONVERSATION_MEMORY_SIZE = Number(
	process.env.CONVERSATION_MEMORY_SIZE
);

function getConversation(key: string): ChatMessage[] {
	if (!conversationMap.has(key)) {
		conversationMap.set(key, []);
	}
	return conversationMap.get(key)!;
}

function addMessage(key: string, role: ChatRole, content: string): void {
	const convo = getConversation(key);
	convo.push({ role, content });

	if (convo.length > CONVERSATION_MEMORY_SIZE) {
		convo.splice(0, convo.length - CONVERSATION_MEMORY_SIZE);
	}
}

function resetConversation(key: string): void {
	conversationMap.delete(key);
}

export { addMessage, getConversation, resetConversation };
```

- [ ] **Step 4: Run the focused conversation tests**

Run: `node --import tsx --test tests/conversationStore.test.js`

Expected: 2 conversation tests pass.

- [ ] **Step 5: Rename and type the remaining core services**

Run:

```bash
git mv core/createClient.js core/createClient.ts
git mv core/createPGPool.js core/createPGPool.ts
git mv core/loginClient.js core/loginClient.ts
git mv core/ollama.js core/ollama.ts
```

Apply the following signatures and imports while keeping existing messages and control flow:

```ts
// core/createClient.ts
import {
	Client,
	type GatewayIntentBits,
} from "discord.js";

function createClient(intents: GatewayIntentBits[]): Client {
	const client = new Client({ intents });

	if (!client) {
		throw new Error("Client is not defined");
	}

	console.log("[INFO] Created discord client instance");
	return client;
}

export { createClient };
```

```ts
// core/createPGPool.ts
import { Pool } from "pg";

const pool = new Pool();

async function createPGPool(): Promise<void> {
	try {
		const res = await pool.query("SELECT NOW()");
		if (res.rows.length) {
			console.log("[INFO] Connected to PostgreSQL Caitlyn~DB");
		}
	} catch (err) {
		console.error(
			"[Error] PostgreSQL connection failed: \n",
			err instanceof Error ? err.stack : err
		);
	}
}

export { createPGPool, pool };
```

```ts
// core/loginClient.ts
import type { Client } from "discord.js";

function loginClient(client: Client): void {
	client.login(process.env.TOKEN).catch((error: unknown) => {
		console.error("Error logging in:", error);
	});
}

export { loginClient };
```

```ts
// core/ollama.ts
import type {
	ChatMessage,
	OllamaChatResponse,
} from "../types/models.js";

async function chat(messages: ChatMessage[]): Promise<string> {
	const response = await fetch(process.env.OLLAMA_CHAT_ENDPOINT, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: process.env.OLLAMA_MODEL,
			messages,
			stream: false,
		}),
	});
	const data = (await response.json()) as OllamaChatResponse;
	return data.message.content;
}

export { chat };
```

Change the import in `tests/ollama.test.js` to:

```js
const { chat } = require("../core/ollama.ts");
```

- [ ] **Step 6: Type-check and run tests**

Run: `npm run typecheck`

Expected: no TypeScript errors in `types` or converted `core` files.

Run: `npm test`

Expected: 5 tests pass.

- [ ] **Step 7: Commit the core conversion**

```bash
git add core types/models.ts tests/conversationStore.test.js tests/ollama.test.js package.json
git commit -m "refactor: convert core services to TypeScript"
```

---

### Task 4: Convert dynamic loaders and application bootstrap

**Files:**

- Create: `types/command.ts`
- Create: `types/event.ts`
- Create: `types/discord.d.ts`
- Create: `tests/loaders.test.js`
- Rename: `handlers/commandHandler.js` to `handlers/commandHandler.ts`
- Rename: `handlers/eventHandler.js` to `handlers/eventHandler.ts`
- Rename: `handlers/cronJobHandler.js` to `handlers/cronJobHandler.ts`
- Rename: `core/deployCommands.js` to `core/deployCommands.ts`
- Rename: `main.js` to `main.ts`

**Interfaces:**

- Produces: `BotCommand`, `BotEvent`, typed `Client.commands`, typed `Client.cooldowns`, source/compiled extension-aware module discovery, and a typed application entry point.
- Consumes: typed core services from Task 3 and existing dynamic `require()` behavior.

- [ ] **Step 1: Add command and event contracts**

Create `types/command.ts`:

```ts
import type {
	AutocompleteInteraction,
	ChatInputCommandInteraction,
} from "discord.js";
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";

interface CommandData {
	readonly name: string;
	toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
}

export interface BotCommand {
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<unknown>;
	category: string;
	cooldown?: number;
	data: CommandData;
	execute: (interaction: ChatInputCommandInteraction) => Promise<unknown>;
}
```

Create `types/event.ts`:

```ts
import type { ClientEvents } from "discord.js";

export interface BotEvent<K extends keyof ClientEvents = keyof ClientEvents> {
	execute: (...args: ClientEvents[K]) => Promise<unknown> | unknown;
	name: K;
	once?: boolean;
}
```

Create `types/discord.d.ts`:

```ts
import type { Collection } from "discord.js";
import type { BotCommand } from "./command.js";

declare module "discord.js" {
	interface Client {
		commands: Collection<string, BotCommand>;
		cooldowns: Collection<string, Collection<string, number>>;
	}
}
```

- [ ] **Step 2: Add failing loader tests**

Create `tests/loaders.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Client } = require("discord.js");

const { commandHandler } = require("../handlers/commandHandler.ts");
const { eventHandler } = require("../handlers/eventHandler.ts");

test("loads every TypeScript command module", () => {
	const client = new Client({ intents: [] });

	commandHandler(client);

	assert.equal(client.commands.size, 7);
});

test("registers every TypeScript event module", () => {
	const client = new Client({ intents: [] });

	eventHandler(client);

	assert.equal(client.listenerCount("interactionCreate"), 1);
	assert.equal(client.listenerCount("messageCreate"), 1);
	assert.equal(client.listenerCount("ready"), 1);
});
```

Run: `node --import tsx --test tests/loaders.test.js`

Expected: FAIL because the TypeScript handler files do not exist.

- [ ] **Step 3: Rename and type the handlers**

Run:

```bash
git mv handlers/commandHandler.js handlers/commandHandler.ts
git mv handlers/eventHandler.js handlers/eventHandler.ts
git mv handlers/cronJobHandler.js handlers/cronJobHandler.ts
```

In each dynamic loader, select the source `.ts` files under `tsx` and emitted `.js` files under Node:

```ts
const moduleExtension = path.extname(__filename);
const moduleFiles = fs
	.readdirSync(modulePath)
	.filter((file) => file.endsWith(moduleExtension));
```

Use these handler signatures:

```ts
function commandHandler(client: Client): void;
function eventHandler(client: Client): void;
function startCronJobs(client: Client): void;
```

Cast dynamically required modules at their boundary:

```ts
const command = require(filePath) as BotCommand;
const event = require(filePath) as BotEvent;
```

Keep synchronous directory discovery. Preserve the command-loader log as `[INFO] Command Handler loaded ${client.commands.size} commands from ${commandFolders.length} folders.` and the event-loader log as `[INFO] Event Handler loaded ${eventFiles.length} events from the events folder.`.

- [ ] **Step 4: Rename and type command deployment**

Run: `git mv core/deployCommands.js core/deployCommands.ts`

Use the runtime extension filter from Step 3 and declare deployment data as:

```ts
import type { RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord-api-types/v10";
import type { BotCommand } from "../types/command.js";

const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [];
```

Narrow the final REST result only for the existing length log:

```ts
const data = (await rest.put(
	Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
	{ body: commands }
)) as unknown[];
```

- [ ] **Step 5: Rename and type the entry point**

Run: `git mv main.js main.ts`

Replace static `require()` calls with named imports using `.js` specifiers, which TypeScript resolves to source `.ts` and preserves as emitted `.js` paths:

```ts
import { GatewayIntentBits } from "discord.js";
import { createClient } from "./core/createClient.js";
import { createPGPool } from "./core/createPGPool.js";
import { loginClient } from "./core/loginClient.js";
import { commandHandler } from "./handlers/commandHandler.js";
import { eventHandler } from "./handlers/eventHandler.js";
import { startCronJobs } from "./handlers/cronJobHandler.js";
```

Keep the intent list and startup call order unchanged.

- [ ] **Step 6: Run loader tests and type checking**

Run: `npm test`

Expected at this intermediate point: conversation and social tests pass; loader tests may still fail because events and commands remain `.js` while the TypeScript loaders select `.ts`.

Temporarily allow both extensions during the migration:

```ts
const moduleFiles = fs
	.readdirSync(modulePath)
	.filter((file) => file.endsWith(".js") || file.endsWith(".ts"));
```

Run: `npm test`

Expected: 7 tests pass.

Run: `npm run typecheck`

Expected: converted loader/bootstrap files have no TypeScript errors.

- [ ] **Step 7: Commit the loader and bootstrap conversion**

```bash
git add core/deployCommands.ts handlers main.ts types tests/loaders.test.js
git commit -m "refactor: type application loading and startup"
```

---

### Task 5: Convert message processing and Discord events

**Files:**

- Rename: all files under `messages/*.js` to `messages/*.ts`
- Rename: all files under `events/*.js` to `events/*.ts`
- Modify: `tests/socialMediaMessage.test.js`
- Modify: `tests/loaders.test.js`

**Interfaces:**

- Produces: typed message handlers accepting guild messages, concrete event modules, and typed external response objects for Giphy/VXTwitter/Ollama.
- Consumes: `BotEvent`, `ChatMessage`, `BirthdayRow`, and the typed core functions from Tasks 3 and 4.

- [ ] **Step 1: Point the social-media test at TypeScript source**

Change the import in `tests/socialMediaMessage.test.js` to:

```js
const { socialMediaMessage } = require("../messages/socialMediaMessage.ts");
```

Run: `node --import tsx --test tests/socialMediaMessage.test.js`

Expected: FAIL because `messages/socialMediaMessage.ts` does not exist.

- [ ] **Step 2: Rename the message modules**

Run:

```bash
git mv messages/birthdayReminderMessage.js messages/birthdayReminderMessage.ts
git mv messages/caitlynAI.js messages/caitlynAI.ts
git mv messages/socialMediaMessage.js messages/socialMediaMessage.ts
git mv messages/twitterVideoMessage.js messages/twitterVideoMessage.ts
```

Type active message functions with `Message<true>` and explicit promise returns:

```ts
async function socialMediaMessage(message: Message<true>): Promise<void>;
async function caitlynAI(message: Message<true>): Promise<void>;
async function birthdayReminderMessage(client: Client): Promise<void>;
async function twitterVideoMessage(message: Message<true>): Promise<void>;
```

Use a narrow response interface in `twitterVideoMessage.ts` before accessing `response.json()` data:

```ts
interface VXTwitterResponse {
	date: string;
	media_extended?: Array<{ preview_image_url?: string }>;
	mediaURLs?: string[];
	text?: string;
	tweetURL: string;
	user_name: string;
	user_profile_image_url: string;
	user_screen_name: string;
}
```

Preserve the current URL mappings, message text, and send/delete order.

- [ ] **Step 3: Make message dispatch explicitly asynchronous without changing feature order**

In `handlers/messageHandler.ts`, use:

```ts
async function messageHandler(message: Message<true>): Promise<void> {
	if (message.author.bot || !message.content) return;

	if (LLM_ENABLED === "true") {
		await caitlynAI(message);
	}

	await socialMediaMessage(message);
}
```

This preserves the existing LLM-then-social call order while allowing the event wrapper to observe failures.

- [ ] **Step 4: Rename and type the events**

Run:

```bash
git mv events/interactionCreate.js events/interactionCreate.ts
git mv events/messageCreate.js events/messageCreate.ts
git mv events/ready.js events/ready.ts
```

Use `export = event` so dynamically required event modules retain their existing runtime shape. For `messageCreate`, narrow to guild messages before calling the handler:

```ts
const event: BotEvent<Events.MessageCreate> = {
	name: Events.MessageCreate,
	async execute(message) {
		if (!message.inGuild()) return;
		await messageHandler(message);
	},
};

export = event;
```

Type `ready` as `BotEvent<Events.ClientReady>` and `interactionCreate` as `BotEvent<Events.InteractionCreate>` while preserving their bodies.

- [ ] **Step 5: Restore single-extension loader filtering**

Now that commands are the only JavaScript modules left, keep dual-extension filtering in the command loader but restore runtime-extension filtering in `handlers/eventHandler.ts`:

```ts
const moduleExtension = path.extname(__filename);
const eventFiles = fs
	.readdirSync(eventsPath)
	.filter((file) => file.endsWith(moduleExtension));
```

- [ ] **Step 6: Run message, event, and type checks**

Run: `npm test`

Expected: 7 tests pass.

Run: `npm run typecheck`

Expected: no errors in converted messages, events, handlers, core, or types.

- [ ] **Step 7: Commit the message and event conversion**

```bash
git add events handlers/messageHandler.ts messages tests
git commit -m "refactor: convert message and event handling to TypeScript"
```

---

### Task 6: Convert birthday scheduling and birthday commands

**Files:**

- Rename: `jobs/birthdayScheduledEvent.js` to `jobs/birthdayScheduledEvent.ts`
- Rename: all files under `commands/user/*.js` to `commands/user/*.ts`
- Modify: `handlers/cronJobHandler.ts`
- Create: `tests/birthdayCommands.test.js`

**Interfaces:**

- Produces: typed birthday cron startup and three `BotCommand` modules with unchanged command names, SQL, and responses.
- Consumes: `BirthdayRow`, `BotCommand`, `pool`, and Discord.js interaction types.

- [ ] **Step 1: Add birthday command metadata tests before renaming**

Create `tests/birthdayCommands.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");

const addBirthday = require("../commands/user/addbirthday.js");
const removeBirthday = require("../commands/user/removebirthday.js");
const showBirthdays = require("../commands/user/showbirthdays.js");

test("preserves birthday slash command names", () => {
	assert.equal(addBirthday.data.name, "addbirthday");
	assert.equal(removeBirthday.data.name, "removebirthday");
	assert.equal(showBirthdays.data.name, "showbirthdays");
});
```

Run: `node --import tsx --test tests/birthdayCommands.test.js`

Expected: 1 test passes.

- [ ] **Step 2: Rename and type birthday scheduling**

Run: `git mv jobs/birthdayScheduledEvent.js jobs/birthdayScheduledEvent.ts`

Use:

```ts
import type { Client } from "discord.js";

function startBirthdayScheduledEvent(client: Client): void {
	cron.schedule("0 9 * * *", () => {
		void birthdayReminderMessage(client);
	});
	console.log(
		"[INFO] Birthday scheduled event started, running every day at 9 AM."
	);
}

export { startBirthdayScheduledEvent };
```

Update the import in `handlers/cronJobHandler.ts` to `../jobs/birthdayScheduledEvent.js`.

- [ ] **Step 3: Rename and type birthday commands**

Run:

```bash
git mv commands/user/addbirthday.js commands/user/addbirthday.ts
git mv commands/user/removebirthday.js commands/user/removebirthday.ts
git mv commands/user/showbirthdays.js commands/user/showbirthdays.ts
```

For each file, import the command contract:

```ts
import type { BotCommand } from "../../types/command.js";
```

Replace `module.exports = {` with `const command: BotCommand = {`, leave every field inside that object in its original order, and append this after its closing `};`:

```ts
export = command;
```

Use required option access so TypeScript knows birthday inputs exist:

```ts
const user = interaction.options.getUser("user", true);
const day = interaction.options.getInteger("day", true);
const month = interaction.options.getString("month", true);
const year = interaction.options.getInteger("year", true);
```

Type PostgreSQL results without changing SQL:

```ts
const res = await pool.query<BirthdayRow>(
	"SELECT * FROM discord.birthdays"
);
```

Define the Giphy response used by `showbirthdays.ts`:

```ts
interface GiphyResponse {
	data?: {
		images?: {
			original?: { url?: string };
		};
	};
}
```

Cast Giphy JSON to `GiphyResponse` and type month entries as:

```ts
interface BirthdayDisplay {
	day: number;
	text: string;
}

const months: BirthdayDisplay[][] = Array.from(
	{ length: 12 },
	() => []
);
```

- [ ] **Step 4: Point birthday tests at TypeScript modules**

Change the three imports in `tests/birthdayCommands.test.js` from `.js` to `.ts`.

Run: `node --import tsx --test tests/birthdayCommands.test.js`

Expected: 1 test passes.

- [ ] **Step 5: Run full tests and type checking**

Run: `npm test`

Expected: 8 tests pass.

Run: `npm run typecheck`

Expected: no errors in birthday scheduling or commands.

- [ ] **Step 6: Commit the birthday conversion**

```bash
git add commands/user handlers/cronJobHandler.ts jobs tests/birthdayCommands.test.js
git commit -m "refactor: convert birthday features to TypeScript"
```

---

### Task 7: Convert utility commands and finish command loading

**Files:**

- Rename: all files under `commands/utility/*.js` to `commands/utility/*.ts`
- Modify: `handlers/commandHandler.ts`
- Modify: `core/deployCommands.ts`
- Modify: `tests/loaders.test.js`
- Create: `tests/utilityCommands.test.js`

**Interfaces:**

- Produces: four typed utility `BotCommand` modules and `.ts`/`.js` runtime-aware command discovery.
- Consumes: `BotCommand`, the Discord client augmentation, and the typed command loader.

- [ ] **Step 1: Add utility command metadata tests before renaming**

Create `tests/utilityCommands.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");

const ping = require("../commands/utility/ping.js");
const reload = require("../commands/utility/reload.js");
const server = require("../commands/utility/server.js");
const user = require("../commands/utility/user.js");

test("preserves utility slash command names", () => {
	assert.equal(ping.data.name, "ping");
	assert.equal(reload.data.name, "reload");
	assert.equal(server.data.name, "server");
	assert.equal(user.data.name, "user");
});
```

Run: `node --import tsx --test tests/utilityCommands.test.js`

Expected: 1 test passes.

- [ ] **Step 2: Rename and type utility commands**

Run:

```bash
git mv commands/utility/ping.js commands/utility/ping.ts
git mv commands/utility/reload.js commands/utility/reload.ts
git mv commands/utility/server.js commands/utility/server.ts
git mv commands/utility/user.js commands/utility/user.ts
```

For each file, add:

```ts
import type { BotCommand } from "../../types/command.js";
```

Replace `module.exports = {` with `const command: BotCommand = {`, preserve every existing field inside the command object, and append:

```ts
export = command;
```

In `reload.ts`, make the necessary spelling correction exposed by type checking:

```ts
const commandName = interaction.options
	.getString("command", true)
	.toLowerCase();
```

Use the current runtime extension so reload resolves `.ts` during development and `.js` in `dist`:

```ts
const moduleExtension = path.extname(__filename);
const commandPath = `../${command.category}/${command.data.name}${moduleExtension}`;
```

- [ ] **Step 3: Point utility tests at TypeScript modules**

Change the four imports in `tests/utilityCommands.test.js` from `.js` to `.ts`.

Run: `node --import tsx --test tests/utilityCommands.test.js`

Expected: 1 test passes.

- [ ] **Step 4: Restore single-extension command discovery**

In both `handlers/commandHandler.ts` and `core/deployCommands.ts`, use:

```ts
const moduleExtension = path.extname(__filename);
const commandFiles = fs
	.readdirSync(commandsPath)
	.filter((file) => file.endsWith(moduleExtension));
```

This completes the temporary mixed JavaScript/TypeScript transition.

- [ ] **Step 5: Verify all source loaders and commands**

Run: `npm test`

Expected: 9 tests pass.

Run: `npm run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 6: Commit the utility conversion**

```bash
git add commands/utility core/deployCommands.ts handlers/commandHandler.ts tests
git commit -m "refactor: convert utility commands to TypeScript"
```

---

### Task 8: Repair linting and enforce the established style for TypeScript

**Files:**

- Rename: `eslint.config.js` to `eslint.config.mjs`
- Modify: `eslint.config.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: converted `.ts` files only where lint reports violations

**Interfaces:**

- Produces: `npm run lint` with TypeScript parsing and the repository's existing formatting rules.
- Consumes: all converted TypeScript source and tests.

- [ ] **Step 1: Demonstrate the existing lint failure**

Run: `npx eslint .`

Expected: FAIL while loading `eslint.config.js` because `@eslint/js` is imported incorrectly as a named ESM export.

- [ ] **Step 2: Install current TypeScript-aware ESLint packages**

Run:

```bash
npm install --save-dev eslint@latest @eslint/js@latest typescript-eslint@latest
```

- [ ] **Step 3: Rename and replace the flat lint configuration**

Run: `git mv eslint.config.js eslint.config.mjs`

Use:

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist/**", "node_modules/**"],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.js", "**/*.mjs", "**/*.ts"],
		languageOptions: {
			ecmaVersion: "latest",
		},
		rules: {
			"arrow-spacing": ["warn", { before: true, after: true }],
			"brace-style": ["error", "stroustrup", { allowSingleLine: true }],
			"comma-dangle": ["error", "always-multiline"],
			"comma-spacing": "error",
			"comma-style": "error",
			curly: ["error", "multi-line", "consistent"],
			"dot-location": ["error", "property"],
			indent: ["error", "tab"],
			"keyword-spacing": "error",
			"max-nested-callbacks": ["error", { max: 4 }],
			"max-statements-per-line": ["error", { max: 2 }],
			"no-console": "off",
			"no-empty-function": "error",
			"no-floating-decimal": "error",
			"no-inline-comments": "error",
			"no-lonely-if": "error",
			"no-multi-spaces": "error",
			"no-multiple-empty-lines": ["error", { max: 2, maxEOF: 1, maxBOF: 0 }],
			"no-shadow": ["error", { allow: ["err", "resolve", "reject"] }],
			"no-trailing-spaces": "error",
			"no-undef": "off",
			"no-var": "error",
			"object-curly-spacing": ["error", "always"],
			"prefer-const": "error",
			quotes: ["error", "double"],
			semi: ["error", "always"],
			"space-before-blocks": "error",
			"space-before-function-paren": [
				"error",
				{ anonymous: "never", named: "never", asyncArrow: "always" },
			],
			"space-in-parens": "error",
			"space-infix-ops": "error",
			"space-unary-ops": "error",
			"spaced-comment": "error",
			yoda: "error"
		},
	}
);
```

- [ ] **Step 4: Add the lint script and remove temporary JavaScript source support**

Add to `package.json`:

```json
"lint": "eslint ."
```

Remove these temporary compiler options from `tsconfig.json` after confirming that no application `.js` files remain:

```json
"allowJs": true,
"checkJs": false
```

- [ ] **Step 5: Run and fix lint errors without reformatting unrelated code**

Run: `npm run lint`

Expected: initially reports concrete style/type-rule violations in converted files. Fix only reported violations, retaining tabs, double quotes, semicolons, and existing comments.

Run: `npm run lint`

Expected: exits successfully with no errors.

- [ ] **Step 6: Run tests and type checking**

Run: `npm test`

Expected: 9 tests pass.

Run: `npm run typecheck`

Expected: no TypeScript errors.

- [ ] **Step 7: Commit linting**

```bash
git add eslint.config.mjs package.json package-lock.json tsconfig.json commands core events handlers jobs messages main.ts
git commit -m "build: lint TypeScript sources"
```

---

### Task 9: Build and verify production output

**Files:**

- Create: `tests/buildOutput.test.js`
- Modify: `package.json`
- Modify: `tsconfig.build.json`

**Interfaces:**

- Produces: a complete `dist` tree containing `main.js` plus every dynamically loaded command and event module.
- Consumes: the fully converted source tree and TypeScript compiler configuration.

- [ ] **Step 1: Add compiled-output checks**

Create `tests/buildOutput.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const expectedFiles = [
	"dist/main.js",
	"dist/core/deployCommands.js",
	"dist/events/interactionCreate.js",
	"dist/events/messageCreate.js",
	"dist/events/ready.js",
	"dist/commands/user/addbirthday.js",
	"dist/commands/user/removebirthday.js",
	"dist/commands/user/showbirthdays.js",
	"dist/commands/utility/ping.js",
	"dist/commands/utility/reload.js",
	"dist/commands/utility/server.js",
	"dist/commands/utility/user.js",
];

test("build emits the entry point and all dynamic modules", () => {
	for (const file of expectedFiles) {
		assert.equal(
			fs.existsSync(path.resolve(file)),
			true,
			`${file} should exist`
		);
	}
});
```

- [ ] **Step 2: Run the output test before building**

Ensure `dist` is absent, then run:

```bash
node --test tests/buildOutput.test.js
```

Expected: FAIL because `dist/main.js` does not exist.

- [ ] **Step 3: Build the production output**

Run: `npm run build`

Expected: `tsc` exits successfully and creates JavaScript and source maps under `dist`.

- [ ] **Step 4: Verify the emitted module tree**

Run: `node --test tests/buildOutput.test.js`

Expected: 1 build-output test passes.

Add a composite verification script to `package.json`:

```json
"check": "npm run typecheck && npm run lint && npm run build && npm test"
```

- [ ] **Step 5: Run the complete local verification**

Run: `npm run check`

Expected: typecheck, lint, compilation, 9 behavior tests, and the build-output test all pass.

- [ ] **Step 6: Commit build verification**

```bash
git add package.json tsconfig.build.json tests/buildOutput.test.js
git commit -m "test: verify compiled application output"
```

---

### Task 10: Update Docker, CI, and migration tracking

**Files:**

- Create: `.dockerignore`
- Modify: `Dockerfile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.todo`

**Interfaces:**

- Produces: a Node.js 24 production image built from compiled TypeScript and CI gates that prevent an invalid image from being published.
- Consumes: `npm run check`, `npm run build`, `npm run deploy:prod`, and `dist` from earlier tasks.

- [ ] **Step 1: Add Docker context exclusions**

Create `.dockerignore`:

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

- [ ] **Step 2: Replace the Dockerfile with a Node.js 24 multi-stage build**

Use:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY types ./types
COPY commands ./commands
COPY core ./core
COPY events ./events
COPY handlers ./handlers
COPY jobs ./jobs
COPY messages ./messages
COPY main.ts ./

RUN npm run typecheck && npm run build

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

CMD ["sh", "-c", "npm run deploy:prod && npm start"]
```

- [ ] **Step 3: Add validation before image publication and update action runtimes**

Keep the workflow's existing trigger and GHCR tags. Change the steps to:

```yaml
steps:
  - uses: actions/checkout@v6

  - uses: actions/setup-node@v6
    with:
      node-version: 24
      cache: npm

  - name: Install dependencies
    run: npm ci

  - name: Check TypeScript application
    run: npm run check

  - name: Log in to GHCR
    run: echo "${{ secrets.CR_PAT }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin

  - name: Build & push
    uses: docker/build-push-action@v7
    with:
      context: .
      push: true
      tags: |
        ghcr.io/razeviana/caitlyn:latest
        ghcr.io/razeviana/caitlyn:${{ github.sha }}
```

- [ ] **Step 4: Build the Docker image locally**

Run: `docker build --tag caitlyn:typescript-migration .`

Expected: both stages complete; the build stage type-checks and compiles, and the final image contains `dist` plus production dependencies.

If Docker is not installed or its daemon is unavailable, record that exact environmental limitation and rely on the Docker build in GitHub Actions; do not claim a successful local image build.

- [ ] **Step 5: Update migration checkboxes**

In `.todo`, mark these items complete with the completion timestamp:

```text
✔ Establish tests for existing bot behavior before upgrading
✔ Upgrade Docker and development runtime from Node.js 20 to Node.js 24 LTS
✔ Declare supported Node.js and npm versions in package.json
✔ Migrate codebase to TypeScript
    ✔ Add TypeScript, tsx, Node types, and tsconfig
    ✔ Define configuration, command, event, and database types
    ✔ Convert existing JavaScript while preserving its code style and CommonJS behavior
    ✔ Add typecheck, development, build, and production scripts
    ✔ Compile production output to dist and update Docker
    ✔ Verify every existing feature after conversion
    ✔ Defer ESM conversion to a separate future task
✔ Upgrade ESLint and repair the broken lint configuration
✔ Update GitHub Actions and add lint/test checks before publishing images
✔ Run regression checks for commands, birthdays, embeds, database access, and optional LLM responses
```

Leave production dependency auditing, `node-cron` v4, `node-fetch` removal, and example environment configuration unchecked because they are subsequent modernization work.

- [ ] **Step 6: Run final verification and inspect repository state**

Run: `npm run check`

Expected: all checks pass.

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only Docker, CI, `.todo`, and `.dockerignore` changes from this task are present.

- [ ] **Step 7: Commit deployment and tracking changes**

```bash
git add .dockerignore Dockerfile .github/workflows/ci.yml .todo
git commit -m "build: run TypeScript application on Node 24"
```

- [ ] **Step 8: Review the complete branch**

Run: `git log --oneline main..typescript-migration`

Expected: the planning commit followed by focused test, toolchain, conversion, lint, build-verification, and deployment commits.

Run: `git status --short --branch`

Expected: `## typescript-migration` with a clean working tree.
