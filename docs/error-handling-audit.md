# Error-handling audit

Reviewed: 2026-09-05, against modernization checkpoint `8ea6f5e` plus the local database-bootstrap improvements.

The findings below record the pre-fix behavior. The user subsequently authorized implementation; startup, database/event errors, transactional activity writes, safe replacements, command responses/cooldowns, birthdays, and AI/API handling are now hardened. See [implementation status, verification, and rollout requirements](resilience.md). Birthday reminder catch-up and Docker/live rollout verification remain separate follow-ups; historical snapshot cleanup is out of scope at the owner's request. AI is disabled in the Git-ignored local `.env`, and a regression test verifies that an absent `LLM_ENABLED` defaults to disabled. An explicit `LLM_ENABLED=true` still opts in; `/toggleai` remains available to administrators.

The review covered startup, PostgreSQL services, event/interaction dispatch, slash commands, scheduled birthdays, AI/memory, link replacement, shutdown, and command deployment. Reproductions used synthetic fixtures and mocked services in isolated Node processes. No Discord login, command deployment, external API call, production database write, or interruption of the local database service was performed.

## Priority 1: availability and data integrity

### 1. Database failure does not stop startup; login success is reported too early

Sources: [createPGPool.ts](../core/createPGPool.ts), [loginClient.ts](../core/loginClient.ts), [main.ts](../main.ts).

**Reproduced:** a rejected database probe still loads commands/events, schedules jobs, and logs `Bot started successfully`. The login helper returns `undefined`, so startup also reports success while the login promise is pending. A later login rejection is only logged, leaving the process and scheduled jobs running without a usable Discord session.

Fix direction: make the database probe and Discord login propagate their failures; await both, report readiness only after success, and clean up resources if initialization fails. Add bounded retries for transient startup failures, then exit nonzero or explicitly enter a documented degraded mode. Do not silently claim success.

Acceptance: unavailable DB, wrong DB credentials, and rejected Discord login cannot produce a success log or leave running jobs behind; a slow connection has a finite deadline.

### 2. Background database and message errors can exit the entire process

Sources: [createPGPool.ts](../core/createPGPool.ts), [createClient.ts](../core/createClient.ts), [eventHandler.ts](../handlers/eventHandler.ts), [messageCreate.ts](../events/messageCreate.ts), [caitlynAI.ts](../messages/caitlynAI.ts), [main.ts](../main.ts).

**Reproduced:** the pool and Discord client have zero `error` listeners. Emitting a simulated pool error throws. With AI enabled, a DB context failure followed by a failed Discord fallback send escapes through the detached `void messageHandler(message)` as an unhandled rejection. The application-wide uncaught-exception/unhandled-rejection handlers exit with status 1.

The installed Discord.js client captures returned listener rejections into its `error` event; the detached message promise bypasses that mechanism. Neither route currently has an application-level recovery boundary. Idle database connections can raise pool errors during an outage independently of any query's `catch`. [node-postgres pool error documentation](https://node-postgres.com/apis/pool#events).

Fix direction: await/contain message operations, protect all event entry points, add pool/client error listeners, and make fallback replies best-effort. Treat expected service/permission errors locally; reserve process termination for failures that make continued execution unsafe.

Acceptance: DB disconnection, missing send permission, deleted channels, and rejected fallback messages are logged without unhandled rejections or process-wide exits.

### 3. Activity writes can partially commit and double-count on retry

Sources: [activityTracker.ts](../core/activityTracker.ts), [voiceStateUpdate.ts](../events/voiceStateUpdate.ts).

**Reproduced:** simulating failure on the third voice-leave write, then retrying a five-second session, increments the total by **ten seconds**. Session update, aggregate increment, and daily increment are separate autocommit queries. The retained in-memory session permits replay of already-successful writes. Message count and voice-join writes have similar partial-write risks.

**Inspected:** voice sessions are tracked in a process-local map. A restart loses that map; moving channels after a failed leave can replace the retained session with the new join. Shutdown does not reconcile active sessions.

Fix direction: run related writes on one checked-out client in a transaction; make session finalization idempotent and recover open sessions from the database. Do not add automatic write retries until duplicate effects are prevented.

Acceptance: fail each write in turn, retry, and confirm exact counters and a single finalized session; test restart and channel-move recovery.

### 4. Failed replacements remove working content

Sources: [socialMediaMessage.ts](../messages/socialMediaMessage.ts), [reload.ts](../commands/utility/reload.ts).

**Reproduced:** successful deletion followed by failed link replacement loses the original Discord message and silently returns. A failed command import deletes the existing command from the registry.

Fix direction: send a replacement before deleting the original; log partial failures and retain original content when sending fails. Import and validate a replacement command before atomically replacing the registry entry. Restrict operational reload access and avoid exposing raw internal error details.

Acceptance: missing permissions, unavailable channels, broken imports, and malformed replacement modules leave the original message/working command intact.

## Priority 2: useful responses and predictable behavior

### 5. Commands time out or misreport database failures

Sources: [interactionCreate.ts](../events/interactionCreate.ts), [activityTracker.ts](../core/activityTracker.ts), [activity.ts](../commands/user/activity.ts), [streaks.ts](../commands/utility/streaks.ts), [addbirthday.ts](../commands/user/addbirthday.ts), [removebirthday.ts](../commands/user/removebirthday.ts).

**Reproduced:** DB failures become `null`/empty activity results, so commands falsely claim there is no activity. Birthday lookup failures send no reply. A successful birthday insert also sends no confirmation. Unhandled command errors in the dispatcher are logged without notifying the user. Missing commands similarly receive no response.

**Inspected:** activity, streak, and birthday mutation commands perform database work before deferring. Discord requires an initial acknowledgement within three seconds, so a slow DB can invalidate an otherwise recoverable command. Several catch blocks blindly call `reply` or `editReply` without considering whether the interaction was acknowledged or whether the error response itself fails. [Discord interaction response documentation](https://docs.discord.com/developers/interactions/receiving-and-responding).

Fix direction: defer slow commands early, distinguish empty results from unavailable services, and introduce a shared safe reply/edit/follow-up helper. Provide a short retryable error without leaking connection details. Test unavailable commands and missing guild/member context too.

### 6. Cooldowns reset on every interaction

Source: [interactionCreate.ts](../events/interactionCreate.ts).

**Reproduced:** two immediate uses by the same user both execute despite a five-second cooldown. Every interaction replaces `client.cooldowns` with a new collection, losing prior timestamps.

Fix direction: initialize the collection once, retain per-command/per-user timestamps, and guard cleanup against deleting newer entries. Add repeated-user, different-user, expiry, and simultaneous-request tests.

### 7. Birthday date and concurrency edge cases

Sources: [addbirthday.ts](../commands/user/addbirthday.ts), [showbirthdays.ts](../commands/user/showbirthdays.ts), [birthdayReminderMessage.ts](../messages/birthdayReminderMessage.ts), [009 migration](../migrations/009_create_birthdays_table.sql).

**Reproduced:** a valid May 31 birthday throws `RangeError` before validation because the code constructs a date using `day + 1`. In UTC, May 28 is stored as May 29. A birthday occurring today at noon is displayed as 365 days away because midnight is compared with the current time before the same-day check.

**Inspected:** select-then-insert is not atomic and the legacy schema has no unique constraint on Discord ID, allowing concurrent duplicate birthdays. The new migration intentionally matches that schema; it does not change existing data or resolve duplicates. February 29 handling outside leap years and reminder catch-up after downtime are not explicitly defined.

Fix direction: use validated date-only values, compare calendar days, establish a leap-day policy, and separately migrate uniqueness after checking existing duplicates. Use an upsert once uniqueness is enforced. Do not automatically rewrite birthdays already stored; the historic timezone workaround makes their intended dates uncertain.

### 8. AI errors are either invisible or misleading

Sources: [ollama.ts](../core/ollama.ts), [caitlynAI.ts](../messages/caitlynAI.ts), [embeddingService.ts](../core/embeddingService.ts), [messageStore.ts](../core/messageStore.ts), [toggleai.ts](../commands/utility/toggleai.ts).

**Reproduced:** an HTTP 503 in `chat` is swallowed and returns `undefined`, causing no user-facing error. If storing memory fails after a successful reply, the bot sends both that reply and a misleading processing-failed message. Failure to send the fallback itself rejects. Empty embedding arrays are accepted. Context counts of zero still cause two DB queries and an embedding request.

**Inspected:** chat content types and embedding values/dimensions are not adequately validated. Attachment-only messages can reach empty-text embedding generation. `/toggleai` changes state before sending confirmation; its failure payload uses `MessageFlags` instead of `flags` and does not roll back/report the resulting state reliably. AI remains disabled locally while these issues are outstanding.

Fix direction: make API failures explicit, validate responses, separate reply delivery from best-effort memory persistence, skip disabled context sources, and avoid secondary error spam. Decide whether a memory outage should allow stateless replies with a clear diagnostic rather than blocking AI entirely.

### 9. External operations and output sizes are unbounded at the application level

Sources: [createPGPool.ts](../core/createPGPool.ts), [ollama.ts](../core/ollama.ts), [embeddingService.ts](../core/embeddingService.ts), [showbirthdays.ts](../commands/user/showbirthdays.ts), [caitlynAI.ts](../messages/caitlynAI.ts), [leaderboard.ts](../commands/utility/leaderboard.ts), [streaks.ts](../commands/utility/streaks.ts).

**Inspected:** no application connection/query deadlines, HTTP abort deadlines, or AI concurrency limits are configured. The pool's default connection timeout is disabled. Giphy is fetched before birthday data, so a stalled optional GIF can delay the entire calendar. Scheduled tasks do not opt out of overlap or implement catch-up. [node-postgres pool configuration](https://node-postgres.com/apis/pool#new-pool).

AI replies are sent as one string without chunking. Birthday month fields and leaderboard descriptions are unbounded. Discord limits message content to 2,000 characters, embed descriptions to 4,096, individual field values to 1,024, and total embed text to 6,000. Large valid results can therefore fail at send/build time. [Discord message and embed limits](https://docs.discord.com/developers/resources/message).

Fix direction: finite service-specific deadlines, bounded concurrency, optional-media fallback, and bounded output/pagination. Retry safe reads only when useful; avoid retrying sends or writes blindly after ambiguous failures.

### 10. Shutdown and container startup need explicit recovery behavior

Sources: [main.ts](../main.ts), [cronJobHandler.ts](../handlers/cronJobHandler.ts), [birthdayScheduledEvent.ts](../jobs/birthdayScheduledEvent.ts), [Dockerfile](../Dockerfile), [deployCommands.ts](../core/deployCommands.ts).

**Inspected:** signal handlers log graceful shutdown but immediately call `process.exit` without stopping jobs, draining in-flight operations, ending the DB pool, or destroying the Discord client. Scheduled task handles are discarded. The container starts through a shell/npm command chain, so signal delivery to the Node process also needs verification.

The container redeploys commands on every start. That deployment clears global commands before updating guild commands; a later request failure can leave a partial deployment. A registration outage prevents an otherwise usable bot from starting.

Fix direction: an idempotent, deadline-bounded shutdown coordinator; preserve task handles; validate the container signal path. Separate command publication from ordinary runtime startup and avoid clearing unrelated registrations by default. No live deployment change was made in this audit.

## Suggested implementation order

1. Startup readiness, DB/client error listeners, finite DB deadlines, event containment, and safe interaction replies.
2. Transactional/idempotent activity writes, safe link replacement, and safe command reload.
3. Birthday acknowledgements/date handling, cooldowns, and explicit unavailable-service responses.
4. AI/HTTP validation, timeouts, memory fallback, and output limits.
5. Shutdown/restart recovery, scheduled-job catch-up, and a separate deployment review.

Existing tests intentionally preserve some legacy behavior, including no birthday-insert reply, swallowed service failures, and detached login. Update those expectations when implementing each fix and add targeted failure tests; do not equate the current green suite with complete error resilience.
