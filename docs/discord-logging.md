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

## Privacy and ownership

Only one main-server destination is allowed. Ordinary server administrators cannot configure logging, inspect the destination, or change the selected types. Ownership is checked through Discord's live application metadata, not a hard-coded user ID. Runtime checks protect the commands even if a stale command registration exists elsewhere.

The channel must be hidden from `@everyone`; this is checked during setup and before delivery. Trust the main server's administrators and every role with channel access, since Discord administrators can read private channels. The stream can include message content and activity from all servers, as well as shared startup/service errors. None of it is forwarded to other servers. Old experimental `server`-scope database rows are ignored, not automatically promoted or deleted.

## Delivery and failure behavior

- Discord uses the saved type selection; console output still uses `LOG_LEVEL`. Timestamps, severity labels, message formatting, and error stack traces originate from the same logger.
- Discord copies strip terminal colors, neutralize code fences, suppress embeds and mentions, and redact configured token/password/API-key values, bearer credentials, and URL user information. Redaction is a safeguard, not a guarantee that arbitrary log content is safe to publish.
- The subscription begins after Discord client creation. Up to 100 startup records are buffered until settings first load. Very early validation/client-creation failures, direct third-party stdout/stderr, standalone operational-script output, and the forwarder's own diagnostic warnings remain console-only. Birthday-job failures are explicitly sent through the application logger as well as observed by the scheduler.
- Messages are batched every two seconds, below Discord's 2,000-character limit, with no overlapping send for the destination. Discord.js handles API rate limits. At most 200 queued chunks are retained; older chunks are discarded on overflow. An omission warning accompanies later delivery if warning output is enabled. Individual log records are capped at 16,000 characters in Discord with an ellipsis.
- Missing channels, revoked permissions, a now-public console destination, failed API requests, and timeouts preserve console logging. Delivery waits at most ten seconds before backing off for thirty seconds. An unresolved send remains marked in-flight so more sends cannot accumulate behind it. Failed batches are not blindly retried because delivery may be uncertain.
- Destination changes discard its old queued output. Disabling during channel lookup cancels that pending send; a request already accepted by Discord cannot be recalled.
- A database outage after initialization keeps cached destinations working. Startup configuration failures fall back to console logging and retry loading settings every minute. No automatic schema creation happens during bot startup.
- Shutdown stops subscriptions and timers and attempts one final batch before Discord disconnects, within the existing lifecycle deadlines. Delivery is best-effort, not a durable log archive; crashes, outages, startup-buffer overflow, and a final backlog can omit Discord copies. Console output remains available at its independently configured level.

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

`tests/discordLogging.test.js` covers ownership, main-server/channel restrictions, private command publication, exact level selection, redaction, buffering, failures, and lifecycle cleanup. `tests/logger.test.js` verifies independent Discord/console filtering. `tests/databaseMigrations.test.js` verifies persistence, migration replay, channel-bound level updates, and the disabled main-server reservation in a disposable PostgreSQL database.

No live Discord login, command publication, channel setup, or homeserver deployment was performed while developing this feature.
