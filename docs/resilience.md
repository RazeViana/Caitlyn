# Resilience and rollout

Implemented on `improvements/database-bootstrap`, 2026-09-05. The original findings remain in [the audit](error-handling-audit.md).

## Runtime behavior

- Invalid configuration fails before clients are created. Database startup probes retry transient connection failures up to three times; bad credentials fail immediately. Discord login is awaited. Failed initialization cleans up and exits unsuccessfully; jobs start only after login succeeds.
- PostgreSQL idle-connection and Discord client/gateway errors are logged. Event and message boundaries contain failures. Expected command/service/permission failures do not terminate the process. Unexpected uncaught process-level faults still trigger shutdown.
- Commands acknowledge slow operations before querying the database. Service failures remain distinct from empty results. Error delivery chooses reply, edit, or follow-up according to interaction state and tolerates expired tokens or lost permissions.
- Cooldowns persist per client, command, and user. `/reload` and `/toggleai` require administrator permission in the dispatcher as well as their command metadata. Reload imports and validates before replacing a working command.
- Activity writes use a checked-out PostgreSQL connection and a transaction. Per-user transaction locks serialize counters and voice changes. Voice completion updates only open sessions; a repeated or concurrent completion cannot add the same duration twice. A stale leave for a different channel cannot close a newer session. Failed transactions roll back; failed rollback connections are discarded. No automatic write retry is performed.
- Voice tracking reads persisted sessions rather than relying on a process-local map. A repeated join to the same open channel does not increment again. Ambiguous multiple open sessions are rejected and logged rather than merged speculatively.
- Social links are sent before the original is deleted, preserving trailing text. A send failure retains the original. A deletion failure can leave both messages; this is logged instead of risking data loss.
- Birthday saves use validated `YYYY-MM-DD` values and an atomic upsert. Month ends and timezones no longer alter the requested date. The calendar compares days, not midnight against the current time. February 29's next occurrence is the next leap day; no February 28/March 1 substitution is introduced. Existing stored dates are never automatically corrected.
- AI remains disabled by default and in local `.env`. When enabled, a context failure permits a stateless reply. A memory-write failure after delivery is only logged, not reported as a failed reply. API failures yield a best-effort error response; failed Discord delivery is not blindly retried.
- AI processes at most one message per channel and four channels concurrently. Excess messages are skipped and logged at DEBUG, not queued indefinitely. Attachment-only/empty messages skip AI. Zero context counts skip the corresponding services. Embeddings must contain 768 finite values and must not be all zero.
- AI output disables automatic mentions, is capped at 6,000 UTF-16 code units, and is split into messages of at most 2,000 each without breaking surrogate pairs. Large leaderboard/calendar text is truncated to fit embed limits. Truncation is marked by an ellipsis; interactive pagination is not implemented.

## Deadlines and lifecycle

| Operation | Bound |
| --- | --- |
| PostgreSQL connection/pool acquisition | 5 seconds |
| PostgreSQL server statement | 10 seconds |
| PostgreSQL client query / idle transaction | 15 seconds |
| Discord initial login | 30 seconds |
| Open WebUI request | 45 seconds |
| Embedding request | 10 seconds |
| Optional Giphy request | 3 seconds |
| Signal-triggered shutdown | 15 seconds overall |

HTTP requests use abort signals. Shutdown stops accepting events, stops scheduled jobs, waits for accepted work within a deadline, destroys the Discord client, and closes the pool. Cleanup is idempotent and continues after an individual cleanup failure. The final process deadline can interrupt work that cannot finish. Active jobs are not allowed to overlap.

The Docker command invokes Node directly for signal delivery. Normal container startup no longer publishes Discord commands. Command publication is a separate `npm run deploy:prod` operation, restricted to the configured guild; global commands are left untouched. The image still needs verification on a Docker-enabled host, and no live command publication or deployment was performed.

## Database rollout

Apply migration `009` if birthdays are absent and migration `010` before running the new birthday upsert. Do not replay historical migrations on a restored database. `010` refuses duplicate Discord IDs without deleting any data; resolve duplicates only after deciding which birthday is correct.

On 2026-09-05, applied `009` (no-op for the existing table) and `010` to **local** `caitlyn_test` at `127.0.0.1:5432`. All ten birthday rows and dates were preserved. The new `birthdays_discord_id_key` index is present. The homeserver database has not been migrated.

Historical snapshot cleanup is out of scope at the owner's request. Records remain unchanged, and the runtime still logs ambiguous sessions rather than adding uncertain totals. Persisted sessions survive restart, but missed leave timestamps and accurate downtime duration cannot be inferred from them.

## Deliberate follow-ups

- Design durable birthday reminder catch-up/deduplication after outages. Current jobs run at 9 AM host-local time and do not replay missed notifications. Automatic sending during restart is intentionally not introduced without delivery bookkeeping.
- Verify the Docker build/signal path and publish the updated slash-command metadata in a separate release step.

## Verification

`npm run check` covers typechecking, lint, a clean production build, and isolated behavior/failure tests. `tests/resilience.test.js` covers startup cleanup, transient DB retry policy, error boundaries, event/job draining, cooldowns, safe error responses, transaction cleanup, AI fallbacks/concurrency, HTTP validation/deadlines, and safe reload.

The opt-in PostgreSQL suite uses a disposable database with synthetic data. It checks fresh migrations, birthday replay/uniqueness/concurrent upserts, rollback at each voice write, concurrent retries counting a five-second session once, channel matching, and rollback of partial message counters. It removes only the database it created. See [development instructions](development.md#database-work).
