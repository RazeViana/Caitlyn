# Private main-server logging

Implemented on `features/discord-logging`, based on the signed resilience checkpoint `b998543` merged into local `caitlyn-2.0`. No channel or server ID is hard-coded for logging.

## First-time setup

Logging belongs only in the operator's main server. Other servers never receive forwarded logs, logging setup announcements, or owner DMs on join. Private logging commands are excluded from global command publication; publish them only to your main guild as described below.

1. Create or choose a private text channel. Give Caitlyn **View Channel** and **Send Messages** there.
2. The bot application owner, with administrator permission in the main server, runs `/setup logs channel:#logs`. The name `logs` is only an example; choose your existing private text channel. For a team-owned application, the team's owner performs setup.
3. Use `/setup status` to review the destination or `/setup disable` to stop forwarding. Responses are private to the owner. Disabling retains the main-server reservation and level selection; it does not let another server take over.

Settings are stored in PostgreSQL, survive restarts, and take effect immediately in the running process after a successful save. Other instances refresh configuration every minute. The first successful setup reserves the main server. The owner can change the channel within that server, but setup from another server is rejected—even while forwarding is disabled. No channel or server ID is embedded in code.

## Choosing which logs appear

Run these commands **inside the configured logging channel**, as the bot owner with server administrator permission:

```text
/logs levels types:info,warning,error
/logs levels types:debug,error
/logs levels types:all
/logs levels types:none
/logs status
```

Select exact types: `debug`, `info`, `success`, `warning` (or `warn`), and `error`. Names are case-insensitive. `all` enables every type; `none` pauses Discord output without losing the destination. Defaults are `info,success,warning,error`. This is an exact selection, not a minimum-severity threshold: choosing `error` alone shows only errors.

The selected types persist across restarts. A change clears the old queued output so previously enabled types do not continue draining into the channel; requests already accepted by Discord cannot be recalled. Invalid input or database failures leave the saved/live filter unchanged. The command is rejected in other channels, servers, and DMs, without revealing the destination.

Console `LOG_LEVEL` remains independent. You can show debug logs in Discord while the console stays at INFO or ERROR, without editing `.env` or restarting the bot. Error stacks and timestamps come from the same application logger.

## Activity and data logging

Routine collection details use DEBUG: message receipt/counting, voice sessions and counted time, AI memory operations, social metadata and command handling. Birthday and setting changes use INFO. Logs say whether data was received, read or successfully saved; they do not include message text or birth dates. See [coverage, privacy and examples](data-logging.md). Enable DEBUG alongside the other selected levels with `/logs levels types:all` in the private logging channel. Console settings remain separate.

## Log wording

Use simple words in application log messages: explain what happened, what Caitlyn will do next, and whether the owner needs to act. For example:

- “Found the social preview already in Discord; no second copy sent” instead of “delivery reconciled”.
- “Discord connection interrupted; trying to reconnect” instead of “gateway interrupted; awaiting library recovery”.
- “Could not confirm whether parts of the log were sent” when Discord may have received them; do not call them lost or promise to resend them.

Long log entries can be split into several parts to fit Discord's message limit, so missing-log counts refer to **parts of the log**, not whole entries. Keep useful IDs, error codes, durations and raw error details for troubleshooting, but give them a plain-language explanation. Internal database fields and status codes keep their existing names. This wording pass covers connection handling, private log delivery, birthday checks, social previews and conflicting voice-session records; third-party error text may still use technical terms.

## Privacy and ownership

Only one main-server destination is allowed. Ordinary server administrators cannot configure logging, inspect the destination, or change the selected types. Ownership is checked through Discord's live application metadata, not a hard-coded user ID. Runtime checks protect the commands even if a stale command registration exists elsewhere.

The channel must be hidden from `@everyone`; this is checked during setup and before delivery. Trust the main server's administrators and every role with channel access, since Discord administrators can read private channels. The stream can include message content and activity from all servers, as well as shared startup/service errors. None of it is forwarded to other servers. Old experimental `server`-scope database rows are ignored, not automatically promoted or deleted.

## Delivery and failure behavior

- Discord uses the saved type selection; console output still uses `LOG_LEVEL`. Timestamps, severity labels, message formatting, and error stack traces originate from the same logger.
- Discord copies strip terminal colors, neutralize code fences, suppress embeds and mentions, and redact configured token/password/API-key values, bearer credentials, and URL user information. Redaction is a safeguard, not a guarantee that arbitrary log content is safe to publish.
- The subscription begins after Discord client creation. Up to 100 startup records are buffered until settings first load. Very early validation/client-creation failures, unadapted third-party stdout/stderr, standalone operational-script output, and the forwarder's own diagnostic warnings remain console-only. Birthday scheduler diagnostics now use the application logger; reminder failures remain observed by the scheduler without being logged twice.
- Messages are batched every two seconds, below Discord's 2,000-character limit, with no overlapping send for the destination. Discord.js handles API rate limits. At most 200 waiting chunks plus one frozen batch (under 1,900 content characters) are retained in memory; older waiting chunks are discarded on overflow. Individual log records remain capped at 16,000 characters with an ellipsis.
- Failures **before message creation** (including channel/permission lookup) retain the complete frozen batch and nonce. Definitive rate-limit rejections may retry too. Backoff is 30/60/120/240 seconds, at most five attempts, with a 15-minute retention limit for retryable batches. Privacy and current destination settings are rechecked for each attempt. Other definitive API 4xx rejections retire the batch; 408/network/5xx outcomes are treated conservatively as unconfirmed.
- The ten-second confirmation deadline does not cancel the underlying request or authorize a retry. An unresolved send remains in flight without overlap. Late success is acknowledged without reporting false loss; late rejection is classified before any retry. Ambiguous POST outcomes are **not** automatically replayed. All attempts use a stable nonce and Discord's `enforceNonce`, but uncertain replay safety does not depend on Discord retaining that nonce indefinitely.
- Later warnings distinguish exact counts of queue-overflow chunks, definitively undelivered chunks, and unconfirmed chunks. A six-chunk failed batch is no longer reported as one lost chunk. Notices obey the selected WARN level; recovery confirmations obey SUCCESS. Internal diagnostics contain closed outcomes/counts, not raw transport errors or credentials.
- Destination/level changes discard old queued and retryable output. Disabling or replacing a destination during channel lookup fences that pending send; late completion callbacks cannot change the new destination's state. A request already accepted by Discord cannot be recalled.
- A database outage after initialization keeps cached destinations working. Startup configuration failures fall back to console logging and retry loading settings every minute. No automatic schema creation happens during bot startup.
- Shutdown stops subscriptions and timers and attempts one final batch before Discord disconnects, within the existing lifecycle deadlines. Delivery is best-effort, not a durable log archive; crashes, outages, startup-buffer overflow, and a final backlog can omit Discord copies. Console output remains available at its independently configured level.

## Gateway and scheduled recovery

- Known handshake/network interruptions use grouped WARN messages (at most one per minute per gateway shard), with reconnect-attempt details at DEBUG. Unknown errors remain ERROR. Each continuing outage escalates once after five minutes; an unrecoverable gateway close reports its code and the need for operator action immediately.
- A successful resume or fresh ready event logs one SUCCESS with outage duration, attempts and failure count. Initial healthy readiness does not produce a misleading recovery message. Timers/listeners are removed when the client is destroyed. Discord.js remains responsible for reconnection; Caitlyn does not start a competing login/reconnect loop.
- Login and actual `clientReady` now share a 30-second startup deadline. Jobs start only after readiness, eliminating the observed initial birthday-check skip. A timeout/rejection removes the temporary listener and propagates to existing startup cleanup.
- Birthday missed-execution events coalesce into one current-day check. If Discord is disconnected or another check is active, recovery waits for readiness/completion. It retains the existing same-day cutoff, durable claims and duplicate protection; yesterday's birthdays are not replayed. Shutdown removes deferred work and listeners. Delay diagnostics do not assume CPU overload or sleep without evidence.
- The owner's September 15/16 handshake timeouts coincided exactly with macOS background wakes (22:12:08 and 11:33:20 Amsterdam time). Sleep-related network interruption is the likely trigger; a sleeping laptop cannot provide continuous bot availability. These changes improve handling/visibility, not the host's availability.

## Database and command rollout

Run from the repository root against the intended database:

```bash
npx tsx scripts/runMigration.ts 011_create_guild_settings.sql
npx tsx scripts/runMigration.ts 012_private_logging_levels.sql
```

Migration `011` creates the original settings table. Append-only migration `012` adds level selection and reserves a single main server even when its channel is disabled. Both are safe to reapply. Conflicting operator destinations cause migration failure instead of arbitrary selection or deletion. Existing activity, messages, birthdays, and legacy server settings remain intact. Do not replay migrations `001`–`008` on a restored database.

On 2026-09-06, `011` and `012` were applied to local `127.0.0.1:5432/caitlyn_test` after passing the disposable database suite. The settings table has no configured destinations. No homeserver migration has been applied.

Command publication is explicit and is never part of normal startup. Set `GUILD_ID` in the deployment environment to your main server, then publish its guild commands (including `/setup` and `/logs`):

```bash
npm run deploy
```

To publish the bot's ordinary commands to other servers during an authorized release, use global publication. It deliberately excludes `/setup` and `/logs`:

```bash
npm run deploy -- --global
# Or after compiling:
npm run deploy:prod -- --global
```

Global publication requires `TOKEN` and `CLIENT_ID`, not `GUILD_ID`. It replaces the application's global command set with the non-operator modules and leaves guild registrations untouched. The default deployment updates only the configured guild and leaves global registrations untouched. Re-publishing globally removes any earlier global logging-control registrations; pre-existing guild registrations are not automatically deleted. Use a guild installation with the `bot` and `applications.commands` scopes. See Discord's [application-command documentation](https://docs.discord.com/developers/interactions/application-commands) and [installation/OAuth2 guidance](https://docs.discord.com/developers/platform/oauth2-and-permissions).

This feature keeps **logging private to the main server**; it does not migrate every existing feature to per-server settings. `GUILD_ID`/`GENERAL_CHAT_ID` are still required by legacy birthday configuration, AI enablement remains process-wide, and existing operational commands retain their current administrator controls. Those require a separate multi-server feature audit before opening this bot to untrusted public installations.

## Verification

`tests/discordLogging.test.js` covers ownership, main-server/channel restrictions, private command publication, exact level selection, redaction, transport classification and lifecycle cleanup. `tests/discordLogRecovery.test.js` covers six-chunk failure accounting, backoff/exhaustion/expiry, uncertainty, late acknowledgement, overflow and stale destinations. `tests/discordRecovery.test.js` covers gateway diagnostics and startup readiness; `tests/birthdayScheduleRecovery.test.js` covers missed-tick coalescing and scheduler logging. `tests/logger.test.js` verifies independent Discord/console filtering. `tests/databaseMigrations.test.js` verifies persistence and migration behavior in a disposable PostgreSQL database.

No live Discord login, command publication, channel setup, or homeserver deployment was performed while developing this feature.
