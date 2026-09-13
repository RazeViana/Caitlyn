# Optional feature configuration

Only a nonempty `TOKEN` is required to start the bot. Without it, startup logs a clear error and stops before creating a Discord client. Each optional feature is checked independently; missing/blank or malformed settings disable that feature instead of stopping unrelated features. Diagnostics contain variable names and fixed reasons, never secret values or endpoint contents.

| Feature | Required settings/dependencies | When unavailable |
| --- | --- | --- |
| Database, activity, birthday storage | `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | No startup connection, message/voice tracking or persistence commands; affected commands return a disabled explanation |
| AI chat | `OLLAMA_MODEL`, `WEBUI_API_KEY`, `WEBUI_CHAT_ENDPOINT` | AI stays off and `/toggleai` refuses activation |
| AI memory | Database plus `EMBEDDING_MODEL`, `EMBEDDING_ENDPOINT`; valid optional context counts | Chat can still reply, without context queries, embeddings or storage |
| Birthday reminders | Database plus `GUILD_ID`, `GENERAL_CHAT_ID`; valid optional timezone | No birthday scheduler; configured database birthday commands remain available |
| Birthday GIFs | `GIPHY_API_KEY` | No Giphy request; birthday listing remains available |
| Social previews | Database plus `SOCIAL_WORKER_SOCKET`, `SOCIAL_MEDIA_ENABLED=true` | No runtime/queue polling; original links remain unchanged |
| Private Discord log forwarding | Database plus the existing owner-configured destination | No forwarder without database configuration; console logging continues |

`LLM_ENABLED` and `SOCIAL_MEDIA_ENABLED` default to false and accept only `true`/`false`. A configured AI service can be enabled with `/toggleai`; missing/invalid connection settings cannot be bypassed by that command. Social previews also require per-channel `/social enable` opt-in and an operational broker/backend. There are no new commands to register for these checks.

Startup reports the feature configuration once using the shared logger. Where forwarding is configured, the report is buffered by the private log forwarder before database connection/login and delivered through the existing level filters. Without a database/destination, consult the console. No configuration report is broadcast to other servers or ordinary channels. Invalid `LOG_LEVEL` uses `INFO` and emits a warning; omitted logging/count/timezone defaults remain supported.

These are configuration checks, not proof that an external service is healthy. A fully configured but unreachable database retains its existing three-attempt transient startup policy; invalid credentials fail immediately. Runtime HTTP/Discord/worker failures still use bounded timeouts and existing recovery. No connection settings are guessed from OS defaults when the bot's database feature is unconfigured.

Restart after modifying `.env`; do not rely on partial hot reload. Removing optional settings does not erase stored guild settings, jobs, birthdays or messages. Supplying them again and restarting restores the configured features and their normal durable recovery rules. Command deployment is a separate operation and still requires `TOKEN`, `CLIENT_ID` and `GUILD_ID`.

FxEmbed account variables are not bot requirements. Only the separate `start-env` backend launcher reads `FXEMBED_X_USERNAME`, `FXEMBED_X_AUTH_TOKEN` and `FXEMBED_X_CT0`; bot/broker environment loading deliberately excludes them. That launcher's existing all-fields/private-file checks still apply. Guest retrieval remains available when an account is not configured, subject to X's access restrictions. See [FxEmbed setup](fxembed.md).

Tests cover missing/blank/malformed settings, dependency isolation, token-only startup, safe logs, blocked toggles and persistence commands/autocomplete, no-query event paths, memory-free chat, and no-request GIF fallback. They use synthetic configuration and injected services, not the owner's credentials or live external requests.
