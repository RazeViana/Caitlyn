# Transcript database and member access

This is the bot-side handoff for a future website. It adds local PostgreSQL storage, attendance-scoped voice reading and Discord-channel-scoped chat reading; it does not add a website, HTTP listener, Discord OAuth configuration or public route.

## Capture and storage

Apply migrations `017_transcript_archive.sql`, `018_transcript_operations.sql` and `019_transcript_message_access.sql`, then enable `TRANSCRIPTION_DATABASE_ENABLED=true` with the bot's existing PostgreSQL settings. The test instance uses its existing `caitlyn_test` database. Production and test databases remain separate.

Private daily JSONL files remain the durable capture log. The bot replays complete lines into `discord.transcript_events` every five seconds, including while recording is paused. Each event and its file checkpoint commit together. New events have stable UUIDs; legacy lines get deterministic IDs from their source path and byte offset. Replays use `ON CONFLICT DO NOTHING`, preserving content and the original voice audience. Message rows are grouped by their source text channel rather than a private voice session, including when old files are replayed.

Database downtime does not discard local recordings or pause ongoing capture. `/transcribe status` reports the archive state and import count; ingestion retries automatically. A full or unwritable local log volume still stops capture. Replay is bounded per pass and may take multiple passes for a backlog. Shutdown leaves any unfinished import in the local files for the next startup.

Malformed complete entries are copied to private `quarantine/<guild>/<channel>/` files before their checkpoints advance. Oversized lines are quarantined in bounded fragments across persisted checkpoints. A corrupt source cannot block other channels. Unterminated short tails wait for completion; the writer inserts a newline before a later append. PostgreSQL-incompatible NUL and unpaired surrogates become replacement characters in the database copy while the JSONL original is preserved. Do not grant quarantine access to member readers.

Do not truncate, replace or move active JSONL files. Truncation below a saved checkpoint stops that import. To reconstruct a restored database, stop the bot, preserve a database backup, reset the relevant operator-only checkpoints and restart; immutable event IDs prevent duplication. Never delete original logs as part of migration.

## Access rule

Voice records carry `audienceVersion: 1` and `audienceUserIds`, captured by the bot. A voice entry is visible only to an authenticated account in that event's audience for the same server. Text messages use a separate rule: current Discord access to the source channel, independently of voice attendance.

- Voice buffers for every speaker are flushed **before** adding or removing a participant. A later join cannot expose earlier buffered words; a departure or rejoin starts another segment.
- Speech processing keeps its capture-time audience. Join/leave events include the affected participant at that boundary; later voice events exclude them after departure.
- Membership cache corrections with unknown timing, connection-loss buffers and coalesced overload intervals stay operator-only. A Gateway disconnection closes voice capture.
- There is no Discord administrator or server-owner override for voice attendance. Speech corrections preserve the original audience and original text.
- `message_posted`, `message_edited` and `message_deleted` require current source-channel View Channel and Read Message History. Private threads also require known thread membership or Manage Threads. These are Discord's [channel and thread permissions](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx).
- A member who was never in voice, joined later, left or rejoined may read text history if they currently have channel access. Gaining channel access reveals its captured text history; losing access withdraws it. The same rule covers original posts, edits, deletions, searches and filter menus.
- Message rows expose their source text channel and a `messages-<channel-id>` grouping, never the private voice session that happened to be recording when an older message was captured. Raw older files remain unchanged.

The bot loads guild members, roles, channels and relevant threads, then refreshes permission snapshots every 30 seconds. Observed channel, role, member and thread changes invalidate the snapshots before refreshing them. Discord disconnection and clean shutdown also invalidate them. Snapshots expire after 90 seconds, so missing permissions or a failed/disconnected bot deny text reads instead of granting stale access indefinitely. This is a bounded synchronization delay, not a claim that a database query can observe a Discord change before the bot receives it. Permission health and recovery use Caitlyn's normal private logging and health checks.

These boundaries use the bot's observed Discord events and received audio. They are not a reconstruction of word-level timing, network-delayed speech or proof someone listened through their speakers. Presence while muted or deafened still counts as channel participation.

Legacy voice recordings lacking verified attendance are imported with `audience_version=0` and an empty audience and remain invisible to **every member** through the restricted reader. Old text records with a valid message ID and source channel follow current channel access; missing source information denies access. Never infer access from an old session's whole participant list or from the unrelated activity-counter `voice_sessions` table.

## Tables

`discord.transcript_events` stores one speech segment or activity event per row:

| Fields | Meaning |
| --- | --- |
| `event_id`, `session_id` | Stable event identity and voice-session or text-channel grouping |
| `guild_id`, `channel_id`, `channel_name` | Discord server and recorded voice channel or source text channel |
| `occurred_at`, `ended_at` | UTC capture timestamps; end applies to speech intervals |
| `event_type` | Speech, message, join, leave, presence, voice activity, session boundary or gap |
| `user_id`, `username` | Stable Discord account ID and captured username |
| `content` | Transcribed speech, original message text or activity description |
| `activity_channel_id`, `activity_channel_name` | Destination of a captured post |
| `message_id`, `message_url`, `metadata` | Original message link, attachment names, thread parent and log timezone |
| `audience_version`, `audience_user_ids` | Verified per-event voice attendance; text reads use channel permissions |
| `search_document` | Indexed English full-text search derived from content |

Revision metadata includes `targetEventId`, `actorId` and `actorUsername` where applicable. Speech `metadata.recognition` holds model/language, durations and per-segment probability metrics; these are not calibrated accuracy scores. Message edit/delete targets refer to the original recorded post event. Chat capture is independent of voice sessions and pauses. A bounded recent-message cache deduplicates changes; older originals can be resolved from the archive after a restart. Complete edit events retain their received text; incomplete edits are not fetched later. Deletion records retain the message ID/link and available author information, with no copied body. When an original is unavailable, `targetEventId` may be absent; group revisions by `message_id`. Messages and changes that Discord never delivers during downtime cannot be reconstructed.

`discord.transcript_import_offsets` is private ingestion state, including oversized-line recovery. `discord.transcript_retention` contains monotonic deletion fences that prevent an old file replay from restoring expired rows. `discord.transcript_channel_access` is also private: it holds expiring channel-reader lists. The narrowly scoped `discord.can_read_transcript_message` function returns only a yes/no result for the authenticated transaction identity and is used by the row-security policy. None of these private tables should be granted to the website. Retention defaults off and must be explicitly configured through the bot; see [operations and backups](voice-transcription.md#operations-and-shared-logging).

## Website integration contract

Authenticate with Discord and verify current membership of the configured server before reading. Derive the permanent user ID from Discord's authenticated identity. A query parameter, username, nickname, supplied guild ID or Discord role is not proof of identity. The bot supplies current text-channel permissions; no browser-supplied channel list is accepted.

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

The reader API is unchanged: verified `userId` and `guildId` are sufficient. The database resolves text-channel access through the bot-maintained permission snapshots; an application may additionally check current Discord permissions, but must never bypass database row security. Voice attendance remains immutable and cannot be widened by text-channel permissions.

## Verification and rollback

The ordinary suite checks voice audiences across join/leave/rejoin and delayed inference, independent chat capture, private text/thread permissions, permission invalidation races, reconnects and logging-loop prevention. The opt-in PostgreSQL suite uses a disposable database and real restricted reader role to verify migrations, replay, duplicate prevention, partial lines, downtime recovery, keyword/date filters, menus, pagination, direct SQL denial and pooled identity isolation.

For a deployment rollback, disable database replay or restore the previous bot image and configuration. Leave all archive tables and original files intact. Older versions may not understand the new revision event types; disable replay in those versions. Preserve the pre-deployment database dump and configuration backup according to the server's backup policy.

## Saved uploads and profile images

The bot captures the author's `avatarHash` and immutable attachment descriptors (`id`, `name`, `size`, `contentType`, `url`) for new message snapshots. The archive preserves these fields in metadata; signed Discord CDN URLs stay in the private archive and are never returned by the website API. File bytes are downloaded by a separate, single-flight worker after database ingestion, so network downloads cannot block voice capture. It accepts only HTTPS Discord attachment paths matching the captured channel/attachment IDs, rejects redirects, streams with a two-minute timeout, verifies the exact captured byte count, and atomically publishes private files with SHA-256 hashes. The per-file guard is 1 GiB with a 2 GiB free-space reserve.

Private storage lives below `TRANSCRIPTION_DIRECTORY/assets/<guildId>/`: `events/<sha256(guildId:eventId)>.json` binds each saved upload to its event/channel/message, `files/<sha256(guildId:eventId:attachmentId)>.bin` holds complete bytes, and `profiles.json` contains current cached member avatar hashes (including guild-specific avatars). Files use 0600 and directories 0700. The website mounts only `assets` read-only, sharing the existing container UID 1000; it receives neither raw daily logs nor a bot token. It must authorize the exact message event through RLS before reading a manifest or file. File URLs are authenticated application routes, with no public static directory or CDN cache. Administrators have no bypass.

The worker scans up to 50 attachment-bearing events every five seconds, circulates through the archive, persists pending/ready/unavailable state and retries failed downloads up to twelve times with backoff. Expired CDN URLs are refreshed only for the captured attachment ID/size, never replaced with a newer attachment. Restart/replay preserves completed files; unfinished temporary files are cleaned up. Multiple message revisions preserve separate copies. Old filename-only events are recovered only if Discord still has the exact matching revision (timestamp, text and attachment names); missing or changed revisions stay unavailable. Historical files Discord has deleted cannot be reconstructed.

Profile snapshots include `displayName`, `avatarHash` and `guildAvatarHash`. User/member gateway events publish changes after a 250 ms debounce; a 30-second cache sweep catches missed writes. Startup, reconnects and a five-minute reconciliation fetch current guild members from Discord, repairing missed gateway updates. Failed fetches retain the last cache and retry without blocking attachment capture. Listeners and timers are removed on shutdown. The website refreshes displayed profiles every 30 seconds in visible tabs, including nickname changes and avatar removals; its own signed-in profile comes from the current OAuth guild-member response. The website enriches only already-authorized rows, prefers guild-specific avatars, and otherwise uses the global avatar or Discord's default. Existing transcript entries therefore gain profile images without rewriting append-only records. Voice attendance rules are unchanged; text and file access follows migration 019's current channel permissions, including its documented synchronization/expiry limits.

The existing backup includes this private directory. Indefinite retention remains the default. When an administrator explicitly enables retention, media belonging to expired events is removed only after database deletion has committed; restoring/rolling back application code never requires restoring old conversation data. Ordinary web attachments (including posted audio) are stored; raw voice-session recordings still are not.

The website live feed re-reads the latest 100 authorized events every three seconds and renders them in chronological order. Re-reading the window catches delayed speech whose occurrence time precedes newer messages and removes rows after permissions are revoked. Live updates preserve filters, stop when browsing historical dates, pause in hidden tabs, and follow Amsterdam midnight. Current channel permission snapshots retain the migration 019 refresh/expiry limits. This is completed transcription after inference and archive ingestion, not streaming partial words.
