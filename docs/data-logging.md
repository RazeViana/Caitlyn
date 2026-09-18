# Activity and data logs

Caitlyn logs **what it received, read, saved or sent**, using plain words. These logs describe existing features; they do not add new tracking, database fields, Discord permissions, or a message archive. The owner selected **details only, no message text**.

## Levels

| Level | Used for |
| --- | --- |
| DEBUG | Routine message and voice activity, data reads/writes, AI processing and social-post details; expected skips such as a feature being off |
| INFO | Birthday additions/removals, settings changes and existing feature progress messages |
| SUCCESS | Existing confirmed deliveries and recovered connections |
| WARN | Interrupted or incomplete work, delayed checks and uncertain sends |
| ERROR | Failed operations, database/service problems and connections needing attention |

In the **existing private logging channel**, `/logs levels types:all` includes DEBUG and every other level. `/logs levels types:debug` selects only DEBUG. Console output is independent: `LOG_LEVEL=DEBUG` is needed to show debug lines in the console after a restart. This implementation does not change either saved level selection or `.env`.

## Coverage

| Feature | Details recorded in logs |
| --- | --- |
| Incoming messages | Server, channel, user ID/username, message ID, text length and attachment count; never text or attachment names |
| Message activity | A successful save of user identity, message totals, daily activity and streak data; message/channel IDs connect this result to the received event |
| Voice activity | Join, leave and move events; user/channel details; saved session start/finish, join count updates and seconds actually added; repeated joins and missing sessions are identified |
| Activity commands | Record counts returned for activity/streak rankings and user statistics, plus the command requester; no extra queries to dump every stored row |
| Birthdays | Whose birthday details were saved/deleted and who requested it; record counts for list reads and the existing reminder checks/delivery logs; no date of birth values |
| AI | Whether processing/memory is enabled, service request/reply counts and lengths, selected memory counts, saved message IDs/roles/field names, search-vector length and confirmed reply completion |
| Social previews | Saved request identity, server/channel/sender, task and post IDs, platform, caption length, image/video/file counts, downloaded bytes and quote presence; existing send/compression/original-cleanup results |
| Message edits/deletions | Message identity and preview-check request; saved cancellation counts only when existing preview records were affected |
| Settings and commands | Command name/requester without option values; confirmed birthday, social, AI and private-log setting changes; a handler finishing is not labelled as a successful feature operation |
| User/server/GIF lookups | Which Discord profile/server fields were shown without a new database write; server member count and whether a birthday GIF was returned |

“Received” means Discord sent the event. “Collected” means data was obtained for processing, not necessarily saved. “Saved” is logged only after the relevant database operation finishes; transactional activity logs wait until commit. Failed commits do not produce successful-save lines. This is not a claim that every incoming message is stored: normal activity tracking counts messages, while full conversation storage still requires the existing enabled AI-memory path.

## Privacy and limits

- New collection logs use `core/dataLog.ts` to accept only selected scalar fields, limit string lengths and escape line breaks/control characters. Never pass a raw Discord event, database row, command options object or provider response into logging.
- Message text, AI prompts/replies, memory search vectors, social captions, media bytes, source URLs, attachment names, birth dates and credentials are not added to these collection logs. Older AI text-snippet logs were removed. AI service/memory/reply errors use closed safe reasons because raw errors can include request bodies; unknown error text is withheld.
- User IDs, usernames, channel IDs/names, server IDs and timestamps are still personal/activity information. Keep the existing main-server logging channel private. No logs are forwarded to other servers. Logs of unrelated legacy errors are not a guaranteed content scrubber.
- Bot message-create events are ignored, and known bot message deletions do not produce an activity log. Social cancellations with no affected records remain quiet. Normal log delivery never logs its own successful sends back into the stream.
- DEBUG can be busy: a single message may have separate receipt, activity-save and AI-skip lines. The existing bounded Discord queue, level filters and exact loss notices remain in place; this is not a complete or durable audit archive. No new log file or retention policy is created.
- No new member-join surveillance, voice recording, attachment download or history backfill was added. Existing data collection and feature opt-ins are unchanged; Reddit remains parked.

See [private logging setup and delivery behavior](discord-logging.md). New wording and activity logs need a bot restart to become active. No command definition changed, so command registration is not required.
