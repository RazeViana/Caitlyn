# Transcript database and member access

This is the bot-side handoff for a future website. It adds local PostgreSQL storage and participant-scoped reading; it does not add a website, HTTP listener, Discord OAuth configuration or public route.

## Capture and storage

Apply migrations `017_transcript_archive.sql` and `018_transcript_operations.sql`, then enable `TRANSCRIPTION_DATABASE_ENABLED=true` with the bot's existing PostgreSQL settings. The test instance uses its existing `caitlyn_test` database. Production and test databases remain separate.

Private daily JSONL files remain the durable capture log. The bot replays complete lines into `discord.transcript_events` every five seconds, including while recording is paused. Each event and its file checkpoint commit together. New events have stable UUIDs; legacy lines get deterministic IDs from their source path and byte offset. Replays use `ON CONFLICT DO NOTHING`, preserving both content and the original access list.

Database downtime does not discard local recordings or pause ongoing capture. `/transcribe status` reports the archive state and import count; ingestion retries automatically. A full or unwritable local log volume still stops capture. Replay is bounded per pass and may take multiple passes for a backlog. Shutdown leaves any unfinished import in the local files for the next startup.

Malformed complete entries are copied to private `quarantine/<guild>/<channel>/` files before their checkpoints advance. Oversized lines are quarantined in bounded fragments across persisted checkpoints. A corrupt source cannot block other channels. Unterminated short tails wait for completion; the writer inserts a newline before a later append. PostgreSQL-incompatible NUL and unpaired surrogates become replacement characters in the database copy while the JSONL original is preserved. Do not grant quarantine access to member readers.

Do not truncate, replace or move active JSONL files. Truncation below a saved checkpoint stops that import. To reconstruct a restored database, stop the bot, preserve a database backup, reset the relevant operator-only checkpoints and restart; immutable event IDs prevent duplication. Never delete original logs as part of migration.

## Access rule

Each new record carries `audienceVersion: 1` and `audienceUserIds`, captured by the bot. The website can return a record only to an authenticated account listed in that event's audience for the same server.

- Voice buffers for every speaker are flushed **before** adding or removing a participant. A later join therefore cannot expose earlier buffered words; a departure or rejoin starts another segment.
- Speech processing keeps the audience attached when its audio was captured. Completion time does not change permission.
- Join and leave events include the affected participant at that boundary. Future events exclude them after departure.
- Delayed message events exclude anyone who joined after the message's creation time.
- A message's audience additionally requires source-channel View Channel and Read Message History permissions at capture. Private threads require known thread membership or Manage Threads. Unknown permissions deny access. The original message remains in private operator logs even if its member audience is empty.
- Membership cache corrections with unknown timing, connection-loss buffers and coalesced overload intervals stay operator-only.
- A Gateway disconnection closes voice capture; reconnection starts a new recording session.
- There is no Discord administrator or server-owner override in the member reader.
- `message_edited` and `message_deleted` are separate events with their own audiences, restricted to both the original audience and people present with source-channel access at the change. Do not apply an edit fetched with the bot's owner credentials to a member-visible original; read each revision under that member's row security.
- `transcript_corrected` is an explicit annotation, never a replacement for the original. Its editor must have been an original participant, and its audience matches the original. Show it as a correction with its recorded editor and time.

These boundaries use the bot's observed Discord events and received audio. They are not a reconstruction of word-level timing, network-delayed speech or proof someone listened through their speakers. Presence while muted or deafened still counts as channel participation.

Existing recordings lack verified audience metadata, including the early recording whose labels used nicknames. They are imported with `audience_version=0` and an empty audience, and remain invisible to **every member** through the restricted reader. Never infer access from an old session's whole participant list or from the unrelated activity-counter `voice_sessions` table.

## Tables

`discord.transcript_events` stores one speech segment or activity event per row:

| Fields | Meaning |
| --- | --- |
| `event_id`, `session_id` | Stable event identity and recording-session grouping |
| `guild_id`, `channel_id`, `channel_name` | Discord server and recorded voice channel |
| `occurred_at`, `ended_at` | UTC capture timestamps; end applies to speech intervals |
| `event_type` | Speech, message, join, leave, presence, voice activity, session boundary or gap |
| `user_id`, `username` | Stable Discord account ID and captured username |
| `content` | Transcribed speech, original message text or activity description |
| `activity_channel_id`, `activity_channel_name` | Destination of a captured post |
| `message_id`, `message_url`, `metadata` | Original message link, attachment names, thread parent and log timezone |
| `audience_version`, `audience_user_ids` | Verified per-event member access |
| `search_document` | Indexed English full-text search derived from content |

Revision metadata includes `targetEventId`, `actorId` and `actorUsername` where applicable. Speech `metadata.recognition` holds model/language, durations and per-segment probability metrics; these are not calibrated accuracy scores. Message edit/delete targets refer to the original recorded post event. Only observed current-session changes to the 2,048 tracked posts are covered; no history is fetched after downtime.

`discord.transcript_import_offsets` is private ingestion state, including oversized-line recovery. `discord.transcript_retention` contains monotonic deletion fences that prevent an old file replay from restoring expired rows. Neither table should be granted to the website. Retention defaults off and must be explicitly configured through the bot; see [operations and backups](voice-transcription.md#operations-and-shared-logging).

## Website integration contract

Authenticate with Discord and verify current membership of the configured server before reading. Derive the permanent user ID from Discord's authenticated identity. A query parameter, username, nickname, supplied guild ID or Discord role is not proof of identity or attendance.

Give the website its own PostgreSQL LOGIN role: not a superuser, not the table owner, no `BYPASSRLS`, no membership in the bot/owner role, and no write privileges. Grant only database connection, schema usage, and SELECT on `discord.transcript_events`. Keep its credentials and Discord OAuth tokens on the website's backend. The bot's connection must never be reused for website requests.

Use `createTranscriptionReader` from `core/transcriptionReader.ts` with that restricted pool:

```typescript
const reader = createTranscriptionReader(websiteReadOnlyPool);
const viewer = {
    userId: authenticatedDiscordUser.id,
    guildId: verifiedServerId,
};
const page = await reader.events(viewer, {
    query: "weekend plans",
    from: "2026-10-03T00:00:00+02:00",
    until: "2026-10-04T00:00:00+02:00",
    limit: 100,
});
const menus = await reader.filters(viewer);
```

The helper starts a read-only transaction, checks `row_security_active`, sets transaction-local `caitlyn.viewer_user_id` and `caitlyn.viewer_guild_id`, and queries under PostgreSQL row-level security. It refuses an owner/superuser pool. Settings expire at commit/rollback so pooled connections cannot carry another viewer's identity.

Filters support voice channel, message destination channel, author, session, event type, timestamp range and English keyword/phrase search. Pages are limited to 200 events and use an opaque cursor. Date ranges are inclusive at the start and exclusive at the end; the future website should calculate Amsterdam local-day boundaries with daylight saving.

All timeline views, search results, menus, counts, summaries, exports and direct event lookups must use the same protected table and authenticated identity. Build session headers and durations only from visible events. Do not read the unfiltered JSONL/TXT files or the bot's AI-memory table as a shortcut. Never expose entire sessions just because one entry is visible. Database owners retain maintenance access; that privilege is deliberately unavailable to the website.

Capture-time source-channel permission is stored in the audience. If the website should also withdraw historical posts when source-channel permissions are later revoked, its backend must additionally check current Discord channel permissions before returning them. This can further restrict the recorded audience; it must never expand it.

## Verification and rollback

The ordinary suite checks audience snapshots across join/leave/rejoin, delayed inference and message events, private text/thread permissions and unknown membership. The opt-in PostgreSQL suite uses a disposable database and real restricted reader role to verify migrations, replay, duplicate prevention, partial lines, downtime recovery, keyword/date filters, menus, pagination, direct SQL denial and pooled identity isolation.

For a deployment rollback, disable database replay or restore the previous bot image and configuration. Leave all archive tables and original files intact. Older versions may not understand the new revision event types; disable replay in those versions. Preserve the pre-deployment database dump and configuration backup according to the server's backup policy.
