# Birthday reminder recovery

Caitlyn checks for due birthdays on startup and every five minutes. Reminders become due at **9 AM** and can catch up only until midnight in the selected timezone. It never announces previous days on restart. February 29 is celebrated only on February 29; stored dates are not rewritten or timezone-shifted.

## Configuration

The existing `GUILD_ID` and `GENERAL_CHAT_ID` still select the birthday server and channel. This feature does not add per-server birthday configuration or change private logging ownership.

Optionally set a timezone in `.env`:

```dotenv
BIRTHDAY_TIMEZONE=Europe/Brussels
```

Omit it to preserve the host timezone. Invalid timezone names fail startup validation without exposing their values. Daylight-saving changes are handled by calculating the local calendar day/hour on each check, not by adding 24 hours to yesterday's run. Changing the timezone while workers are running is unsupported: stop them and restart with consistent settings.

The birthday channel needs **View Channel**, **Send Messages**, and **Read Message History** for the bot. Missing permissions or a channel lookup failure leave the announcement unsent and delay another attempt by 5, 10, 20, 40, then at most 60 minutes. Database failures abort the current check, are logged, and are retried on a later five-minute check. Nothing is sent without a persisted send claim.

## Persistent delivery tracking

Migration `013_birthday_delivery_tracking.sql` creates two tables:

- `discord.birthday_occurrences` reserves each server/person/calendar date once, including the year. Removing or editing a birthday does not erase past reservations.
- `discord.birthday_deliveries` records grouped announcements, their destination, delivery state, attempts, and the confirmed Discord message ID.

Preparation is transactional and concurrent-safe. Multiple birthdays stay grouped, with at most 25 mentions per message and only those recipients allowed to be pinged. At most 500 new recipients are queued and 20 due batches processed per check; larger sets continue on later checks while today's window is open. Birthdays added later today get a new batch without repeating people already reserved.

Queued recipients and the destination are snapshots taken when the batch is created. Editing/deleting a birthday or changing the channel afterward does not rewrite an already queued announcement. Do not delete tracking rows to retry a message: doing so removes duplicate protection.

| State | Behavior |
| --- | --- |
| `ready` | Definitely unsent; eligible for a conditional send claim when its delay has elapsed. |
| `sending` | A claim was persisted before requesting delivery; another worker cannot send it. |
| `uncertain` | The request may have succeeded; reconciliation only, never an automatic resend. |
| `sent` | A confirmed Discord message ID is recorded; future checks skip it. |
| `expired` | An unsent batch belongs to a previous day and is not replayed. |

If shutdown, loss of readiness, or midnight occurs after claiming but before a send starts, the definitely unsent claim is released. Later checks still enforce the same-day window. Already submitted Discord requests cannot be cancelled by a local deadline and may complete late.

## Uncertain delivery and recovery

Every announcement includes a small `Birthday reference` line tied to its persisted batch. If a send errors, takes longer than ten seconds, or succeeds but recording its message ID fails, the bot retains the claim. A request still in flight continues to be observed so a late success can be recorded.

Recovery checks scan up to 500 recent messages in the original channel, verifying this bot's author ID and the batch reference. Finding the message marks delivery successful without another announcement. Missing history, a deleted/edited reference, or no match in that bounded scan **does not prove non-delivery**. The batch stays uncertain, is logged for operator review, and is checked again at most once per 15 minutes while today is still eligible. A crashed initial send claim becomes eligible for reconciliation after two minutes; a caught send error/timeout delays reconciliation by five minutes.

Even an apparently failed POST is treated conservatively as uncertain. Automatic retry applies to failures before sending, not to arbitrary send errors. A crash between committing the claim and actually sending can therefore leave an unsent reminder held for review. This is duplicate prevention with conservative recovery, not a guarantee of exactly-once delivery.

The payload also uses a stable nonce and `enforceNonce` for Discord's short-lived duplicate protection. Discord documents this as covering only the past few minutes, so it is not a substitute for persistent tracking. See the [Discord message API](https://docs.discord.com/developers/resources/message#create-message) and [history permissions/limits](https://docs.discord.com/developers/resources/message#get-channel-messages).

To investigate, match the logged batch reference to the original channel's message and inspect the tracking tables read-only. If a result cannot be established, leave the claim held; there is no automatic or command-based force-resend. Old uncertain entries are retained for review, but do not trigger announcements or history scans on later days.

## Logging

All recovery logs use the existing shared logger with the birthday guild's context. They follow the current console threshold and the independent private main-server channel type selection. No public logging channel or new logging configuration is introduced.

- `DEBUG`: skipped checks, due batch counts, and competing claims.
- `INFO`: queued recipients and delivery attempts.
- `SUCCESS`: confirmed sends and existing-message recovery.
- `WARN`: delayed pre-send retries, expired reminders, timeouts, and unresolved delivery.
- `ERROR`: failed checks, send errors, database acknowledgements, and failed reconciliation.

For normal operation, run this **inside the configured private logging channel**:

```text
/logs levels types:info,success,warning,error
```

Use `/logs levels types:all` to include debug checks. `SUCCESS` is a separate selection from `INFO`; it is enabled by the default selection but must be included when choosing exact types. Existing owner/admin restrictions and [log redaction and delivery limits](discord-logging.md) still apply.

## Rollout and verification

1. Stop the old bot before enabling recovery. Old versions do not participate in the new tracking, so do not run old and new versions concurrently.
2. Apply **only the missing migration `013`** to the intended database; do not replay historical migrations on a restored database.
3. Set the desired timezone and verify the birthday channel permissions before starting the new version.
4. For the first deployment, start before 9 AM on a day the old version has not already announced, or wait until the next such day. Tracking starts empty and cannot infer whether an untracked legacy announcement was sent earlier today. Subsequent restarts use the persisted tracking normally.

```bash
npx tsx scripts/runMigration.ts 013_birthday_delivery_tracking.sql
```

No slash-command changes are needed for this feature. Deployment, homeserver migration, or live Discord verification remain separately authorized release steps.

Tests cover timezone/DST boundaries, leap dates, startup catch-up, restart and multi-worker deduplication, database and permission failures, late send completion, uncertain-delivery reconciliation, bounded messages/history, lifecycle cancellation, and guild-scoped logs. The opt-in disposable PostgreSQL suite verifies real migrations, rollback, reservations, claims, retry timing, and replay safety; see [database testing](development.md#database-work).
