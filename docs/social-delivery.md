# Opt-in X preview delivery

Status: the X checkpoint was sanitized, signed and pushed on `codex/social-media-replacement` through `58aacdd`. [TikTok video/share-link support](tiktok.md) is the subsequent feature; see [handoff](handoff.md) for current testing/activation status. The owner authorized local Discord testing while the homeserver is inactive; channels require administrator opt-in. Instagram/Reddit and TikTok slideshows remain unsupported. No integration merge or homeserver deployment has occurred.

## Behavior and configuration

The old hosted-fixer path has been removed. New X/TikTok previews put `Shared by @sender` inside the embed below the post caption and compact source line. It appears once per preview: on the main card for ordinary posts, or beneath the quoted text/source in the lower card for quote tweets, never on gallery continuation cards. The sender's own commentary remains above the card with handled links removed; link-only sources have no standalone text. The social post's own caption is the focus of the card, followed by a compact platform/content label and `Original ↗` link; the author is also clickable. There is no large `View post/video` title or standalone raw source URL. Author names remain plain text without visible Markdown escapes, and media-only posts omit empty-caption filler.

Presentation follows the normalized content, including when media is missing:

- Images: caption above the first full-size image, with ordered, numbered continuation cards and author attribution. Mixed image/video/GIF posts keep their individual attachments and list each media type. Continuation cards do not share the main URL because Discord may deduplicate embeds by URL.
- Videos/GIFs: compact caption card plus verified playable MP4 attachments, with readable names such as `tiktok-post-video-1.mp4` instead of post IDs. No duplicate thumbnail or fake embed-video URL is added. Discord's classic bot-created rich embeds do not accept a custom `video` field ([message/embedding limits](https://docs.discord.com/developers/resources/message#create-message)).
- Text: up to 3,600 escaped characters in a single text-only card, without a media placeholder. Media captions and quote pairs use 1,800 characters per card to stay within the aggregate embed budget.
- Quotes: the quoting tweet's author, commentary and its own images come first. The quoted tweet follows underneath with its own author/caption/media, a muted border, and a compact `Quoted post` source label instead of a large title. `Shared by` and the clean completion footer belong to this lower content card, so they no longer interrupt the tweet pair. Gallery continuations keep their image numbers/authors; captionless quote wrappers add no empty-text filler. Missing quotes and omitted media remain visibly incomplete. Classic Discord embeds are separate stacked cards, not a pixel-identical nested Twitter component; native video placement remains controlled by Discord.

Longer extracted text is attached in full with separate attribution/source URLs if it fits the upload budget. Otherwise the card explicitly reports shortening and cannot authorize original-message deletion. Render diagnostics log only counts/completeness through the existing guild-scoped logger, never caption or media content. No command registration or extraction/worker change is needed for this presentation update.

Caption cleanup uses the same recognition and five-link limit as admission. It removes all visible aliases of handled X/TikTok links, keeps named Markdown link labels, and preserves unrelated/unsupported links, hidden/code/suppressed content and links beyond the admission limit. Those preserved links and genuine URLs in the extracted post text are not indiscriminately removed. Full-text attachments retain attribution and source URLs. The completion footer says only `Caitlyn preview`, without a job ID; it is on the quoted content card when available, otherwise the main card. IDs remain internal to the database/logging/send metadata. Identity checks already search every embed and still require the saved message ID or matching nonce; moving the footer does not relax them.

Only the original sender is allowlisted for mentions; provider text and other source mentions cannot ping roles or everyone. In-card attribution is built from the validated source job's Discord user ID, never a provider-supplied name or mention. Once every supported preview from a source is confirmed complete, Caitlyn removes the unchanged original if it has Manage Messages. Failed/partial previews and messages containing uploads, stickers, polls, reply context, a thread, or text too long to copy retain the original. The previous commentary-length budget, including its old attribution overhead, remains in force so recovery cannot delete an older source whose preview omitted its commentary. Old jobs are not retroactively cleaned up. The owner confirmed the authenticated video path works on September 13; the new presentation awaits a fresh owner-sent link.

At the owner's explicit request, public X posts marked `possibly_sensitive` are processed without an additional Discord channel-age check. The runtime requests `allowSensitive=true`, and parent/quote sensitivity remains validated and recorded. This replaces the earlier application-imposed `nsfw` requirement; channel settings themselves are unchanged. Real X protection/login/age-verification denial remains terminal. An owner-supplied account is now active only in the private FxEmbed backend, using the [.env startup procedure](fxembed.md); the previously failing post subsequently returned a complete verified video. X documents `possibly_sensitive` as a content warning, not proof that the post is inaccessible: [X data dictionary](https://docs.x.com/x-api/fundamentals/data-dictionary). Provider failure alone does not establish whether the cause is login, age verification, removal, or another restriction.

Two independent opt-ins are required:

1. The operator sets `SOCIAL_MEDIA_ENABLED=true` and `SOCIAL_WORKER_SOCKET` after preparing the worker and migrations `014`/`016`. The master switch defaults to **false**; disabled bots never create the polling runtime.
2. A server administrator runs `/social enable` in each desired server text channel. Settings are stored by guild/channel ID; no server IDs are hard-coded. New servers/channels are disabled by default.

`/social disable` cancels pending jobs in the current channel; `/social disable-server` does so throughout the current guild. Existing completed previews are left in place unless their source changes. `/social status` reports saved enabled channels and whether the operator enabled integration, **not** a worker-health probe. The command is guild-only and administrator-only, with ephemeral confirmations. The same opt-in now covers X and [TikTok videos/share links](tiktok.md). Threads, DMs, announcement channels, Instagram/Reddit and TikTok slideshows remain unsupported. Command publication is separate from startup and scoped to the authorized local test's guild.

## Self-hosted retrieval (current)

Caitlyn now uses the pinned [FxEmbed backend](fxembed.md) under `vendor/fxembed`. `SOCIAL_X_PROVIDER=fxembed` is the only accepted mode; omitted configuration selects it. All VX-derived code, hosted VX mode, session-file support and the unused legacy message handler were removed. No fallback to hosted embed services runs.

The broker fetches FxEmbed API v2 JSON from `http://127.0.0.1:8787`, validates identity/media/quotes, and passes bounded JSON to the existing isolated media verifier. Images and fitting MP4s are downloaded, checked, and uploaded to Discord. Metadata-only checks skip the media containers. The local backend uses the owner's configured X session; the broker and media verifier do not receive its cookies. See [private API](self-hosted-media-api.md) and [exact installations](fxembed-installations.md).

## Worker boundary

The bot queues work and contacts a local Unix socket; it never invokes Docker, yt-dlp, Python, FFmpeg, or arbitrary remote media URLs. The trusted host broker is `scripts/socialWorker/server.ts`. It owns Docker access and launches disposable extraction containers using a preinstalled image resolved to an immutable local image ID at startup. Requests contain only a version, canonical X post URL, bounded upload budgets, and an optional boolean enabling public sensitive metadata—not Docker flags, image names, filesystem paths, headers, cookies, or credentials. The runtime sets that boolean to true; standalone probes can remain conservative by omitting it.

Socket paths must be absolute, control-character-free, and at most 100 UTF-8 bytes. The parent directory must already exist, belong to the broker user, and disallow group/other access. The socket is mode `0600`; existing paths are refused, not overwritten. Production should isolate the bot in its own container with only this socket directory mounted and the matching UID. Running both programs as the same Mac account is **not** a host privilege boundary: both inherit that account's permissions. Never mount Docker's control socket or the host home directory into the bot/media containers.

The separate FxEmbed metadata backend has normal outbound networking and a loopback-only API; it is not inside the media gateway. For media verification, the broker uses the existing gateway/network-none worker design:

- One extraction at a time per broker; busy requests fail quickly.
- Fresh gateway per job: approved provider hosts, public IPv4 DNS pinning, HTTPS port only, 128 MiB aggregate tunnel budget, and 20-second tunnel deadlines. No private, loopback, metadata-service, or Tailscale/CGNAT destinations.
- Extraction: no external network interface, credentials, host mounts, or Docker socket; read-only filesystem, UID 1000, dropped capabilities, no-new-privileges, 512 MiB memory, one CPU, 64 PIDs, 96 MiB tmpfs, and a 90-second process deadline. Gateway/verifier lifetimes are also bounded.
- Video requires H.264/AAC (silent GIFs are permitted), bounded dimensions/duration, and a two-second decode check; images require matching MIME/dimensions and a one-frame decode check. These are not full-video corruption checks.
- The production transport uses Docker `--log-driver=none`: media/text output goes only through the private process pipe and Unix connection, not container logs. Ordinary probe mode emits content-free summaries.
- The bot validates JSON shape, post/media ownership, identities, duplicate files, byte limits, base64, SHA-256, and file signatures. Remote media URLs are stripped before rendering. It does not decode media on the host.

Normal cleanup removes only the job's named containers and IPC volume; downloaded media lived in tmpfs. Failed cleanup blocks further jobs in that broker. Startup also refuses leftover resources labelled `dev.caitlyn.social-worker=true`. Inspect those exact resources and the owning process before any manual removal; do not use broad Docker prune commands. A second broker should not share this worker context. There is no remote HTTP worker endpoint, automatic image pulling, container autoscaler, or production service-manager configuration yet.

## Durable delivery and failure handling

Migration `014` creates `discord.social_channels` and `discord.social_jobs`; it is repeat-safe and does not change existing application data. No automatic migration runs at bot startup. It was initially verified in disposable test databases and subsequently applied to the restored local `caitlyn_test` database with the owner's approval for the live local test. It has not been applied to the homeserver by this work.

Migration `016` adds `source_cleanup`, `replacement_ready`, and `sensitive` without changing existing job fields. Applied locally on September 12: all four existing jobs retain `source_cleanup=preserve`; original job fingerprints match. New jobs start `pending`. A source can enter `deleting` only when the current lease is valid and all expected sibling jobs have confirmed, complete, uncancelled sends matching the same source/author/hash. The intent is saved before Discord deletion so the resulting message-delete event does not remove the replacements. Successful or already-missing originals become `deleted`; ambiguous deletion stays recoverable without resending previews. Extra content/permissions/changed sources become `retained`. Every replacement is fetched and identity-checked before deleting a still-present source; that source is fetched again immediately before deletion. Discord provides no atomic compare-and-delete, so an edit racing after the final check remains a small unavoidable window. [Discord message deletion and permissions](https://docs.discord.com/developers/resources/message#delete-message).

Queue records contain scoped IDs, canonical public post URLs, a source-content hash, lease/state/timing fields, and optional preview message IDs. They do not contain downloaded bytes or source/provider text. Unique guild/channel/source/post keys reject duplicates. Acceptance is capped at 1,000 active jobs globally, 100 per guild, five visible unique links per message, and 100 configured channels per guild. Admission can decline during concurrent enqueue contention. Old messages/jobs expire after 30 minutes; stale events are not replayed indefinitely.

The worker loop wakes immediately after accepted enqueue/cancellation and claims the next due job immediately after finishing one. It waits five seconds only when idle, not ready, or unable to query the queue. Activity tracking runs concurrently with media admission instead of delaying it. Short transactions and conditional lease tokens fence stale processors; no transaction spans network work. Processing leases last five minutes. Definitely unsent transient worker failures can retry up to three extraction attempts, one minute apart. Restricted, rate-limited, unavailable, or malformed results are terminal. Media restrictions yield explicitly partial previews and stop subsequent media requests in that job; only byte overflow may select a smaller candidate.

While actively extracting/sending, Caitlyn shows Discord's native typing indicator as cooking feedback. It refreshes every eight seconds without overlapping requests and stops on completion, error, source change or shutdown. An individual typing operation is bounded to five seconds and failure disables further feedback for that job without failing the preview. A late channel/source lookup checks cancellation before sending. Discord automatically expires the indicator after ten seconds, so no temporary status message or persistent reaction needs cleanup ([typing indicator API](https://docs.discord.com/developers/resources/channel#trigger-typing-indicator)). Queue wait behind another post, provider responses, safe-container startup, downloads, media checks, optional bounded compression and upload still take time. The indicator does not bypass verification/isolation or increase concurrency; no persistent media cache is added.

Before extraction and before claiming a send, the runtime rechecks source content/settings. The Discord adapter checks the source once more immediately before calling send. A saved `sending` state must be acknowledged before the send can happen. Standalone previews mention only the sender and use a deterministic enforced nonce as a short-term aid, not durable exactly-once protection. Their identity does not depend on a reply reference that would break when the source is deleted.

After a timeout, ambiguous send, process restart during sending, or lost database acknowledgement, the job is held as `uncertain`. Recovery searches at most 100 channel-history messages and requires this bot's identity (not a webhook), the correct reference if present, and any already-recorded message ID to match. Older previews remain identifiable by their exact job footer. New clean-footer previews require either the persisted Discord message ID or a matching send nonce; a shared footer/caption/source link alone never proves identity. Discord's `nonce` metadata is optional and its enforced deduplication lasts only a few minutes ([message API](https://docs.discord.com/developers/resources/message#create-message)). If an uncertain new send has neither recorded ID nor returned nonce, it remains uncertain for operator review instead of guessing, deleting the original, or resending. No match is **not** proof of no send. Uncertainty checks repeat after 15 minutes. Late successful sends still attempt to record their message ID. A late state acknowledgement cannot overwrite cancellation or a newer lease.

User source edits/deletions cancel queued work and schedule removal of this bot's identified preview, except when source replacement cleanup has already been durably authorized. Embed-only native updates are ignored. Retained-source previews are rechecked approximately every 15 minutes (subject to backlog) for 30 days, covering missed gateway events or temporary DB failures. Removal retries when permissions/services are unavailable. Concurrent REST requests cannot be atomically cancelled with a database transaction: a preview may briefly appear after an edit/delete and then be removed. This is conservative duplicate avoidance and eventual cleanup, **not** an exactly-once/immediate-removal guarantee.

Finished records expire 30 days after creation; unresolved sends/removals retain evidence for operator review and consume queue capacity. Source changes after retention, or while the master switch remains off, cannot be reconciled by the bot. Turning the master switch off stops processing as well as new previews. Shutdown aborts worker transport and drains pending work before disconnecting services, with bounded deadlines.

Uploads use a conservative 8 MiB/file and 20 MiB aggregate budget, not a guild boost-tier calculation. The renderer additionally reserves 128 KiB for payload/long-text overhead. X and TikTok use the shared, size-only [compression fallback](video-compression.md) inside the isolated worker; X parent/quote videos retain separate attribution and share the remaining message budget. Each affected card labels reduced quality once. Files that cannot fit or pass verification are explicitly omitted and the original Discord message remains. Silent animated GIFs stay original-only. The same platform-neutral helper is intended for the future Reddit adapter, but Reddit is not enabled yet. No persistent media cache, paid API, or hosted-fixer fallback is added. Account authentication is confined to the FxEmbed backend as described above.

## Logging

Runtime work uses the existing `withLogGuild` context and logger: DEBUG admission/idle, INFO extraction/configuration, SUCCESS send/recovery, WARN partial/unavailable/uncertain jobs, and ERROR queue/state failures. Diagnostics include safe outcome categories and IDs, never raw provider errors, cookies, downloaded bytes, or signed media URLs. Existing private main-server forwarding and `/logs levels` filters remain unchanged; other servers do not gain access to operator logs. The standalone broker uses the same logger on its own console; the bot reports job outcomes to its existing private forwarder.

Idle queue diagnostics are limited to once every five minutes, with idle polling every five seconds. Extraction completion logs `duration_ms`, and successful delivery logs `send_ms` (including durable acknowledgement), for content-free latency diagnosis. `gateway_denied` distinguishes a blocked proxy tunnel from a provider's `access_denied`; neither authorizes retries or alternate-host fallback.

### X metadata diagnostics

The active FxEmbed adapter emits closed failure outcomes and optional `FxStatus`/`FxTombstone` diagnostics. Unknown errors and provider notices never enter Discord logs. HTTP/API 401/403 are restricted, 404 unavailable, 429 rate-limited, and 5xx transient backend failures. FxEmbed can collapse upstream failures into 404; that is not proof of deletion or a specific age restriction. The retained generic GraphQL normalizer is offline utility code, not a second extractor.

## Local verification and operator setup

Start the local FxEmbed backend first using [its setup guide](fxembed.md). Reuse the existing tools/image described in [local media testing](local-media-testing.md) and [installation inventory](media-test-installations.md). Do not install dependencies again just to run these checks. Start the dedicated no-host-mount Colima profile as documented there, then build the current API image from the cached dependency baseline:

```bash
node --import tsx scripts/buildSocialWorkerImage.ts colima-caitlyn-media-test caitlyn-media-probe:local
node --import tsx scripts/testSocialDeliveryLocal.ts image
npm run check
CAITLYN_TEST_POSTGRES=1 node --import tsx --test tests/databaseMigrations.test.js
```

The delivery test also accepts `video`, `video-regression` (the owner's failed post), `quote`, or `all`. It exits unsuccessfully if real media is incomplete; a partial response is not reported as success. September 12 debugging traced HTTP 403 to media retrieval after an allowed CDN tunnel. Replacing urllib's generic identity with an honest application User-Agent restored all four cases: image 398,830 bytes; video 3,162,626 bytes; regression post 2,652,337 bytes; quote two clips totaling 1,348,582 bytes. Each passed the real broker/client/renderer with zero omissions. These checks validate the bytes and payload, not actual Discord desktop/mobile playback. No cookies, browser impersonation, credentials, redirected requests, or alternate-host fallback were introduced. See [Python's request-header documentation](https://docs.python.org/3/library/urllib.request.html).

Request identity, proxy use, denial/no-retry behavior, redirect rejection, and byte bounds have five offline Python tests. FxEmbed metadata has separate Node HTTP/normalization tests. Use the already installed image (no host Python packages or network required):

```bash
docker --context colima-caitlyn-media-test run --rm -i --network none --read-only \
  --cap-drop ALL --security-opt no-new-privileges --memory 128m --pids-limit 32 \
  --entrypoint /opt/extractor/bin/python caitlyn-media-api:local - < tests/socialMediaRequest.test.py
```

For a separately authorized activation, first review/apply only missing migrations, choose a private worker socket directory, and arrange isolated service users/containers. Start the broker with the existing checkout tooling and operator-owned configuration, for example:

```bash
SOCIAL_WORKER_DOCKER_CONTEXT=colima-caitlyn-media-test \
SOCIAL_WORKER_IMAGE=caitlyn-media-api:local \
SOCIAL_X_PROVIDER=fxembed \
SOCIAL_WORKER_SOCKET=/path/to/private-directory/worker.sock \
node --import tsx scripts/socialWorker/server.ts
```

The path is illustrative and must exist with the ownership/mode described above. The broker requires source-time `tsx`; scripts are not emitted by the bot's production build. A homeserver deployment needs its own reviewed image build/context and service supervision—do not reuse Mac paths or assume the existing bot Dockerfile packages this broker. Publish `/social`, enable the bot master switch/socket, and opt in only the agreed test channel. No bot login or command publication occurred during the initial isolated verification. The subsequent authorized startup is recorded below; actual Discord preview/playback/error checks still await the owner's test messages.

## Authorized manual Discord test

After the isolated checks above, the owner confirmed the homeserver instance is inactive and authorized using the current bot locally. On 2026-09-12, all 14 current commands were registered in MandemHQ only, including previously absent `/social`, `/setup`, and `/logs`; global registration was not changed. Migrations `014` and `015` are applied locally and Caitlyn is online from the Mac. A subsequently started VS Code bot caused competing acknowledgements; both local processes were stopped and one repaired instance started. The current temporary socket/process details are recorded in [the handoff](handoff.md).

The old smoke check and two user previews were text-only because of the HTTP 403 issue now fixed above. Existing sent previews are not automatically replayed or edited: repost a fresh source link to test the fix. If a provider denies another request, it must remain explicitly partial rather than triggering repeated access attempts.

1. In the text channel you want to test, run `/social enable`, then `/social status`.
2. Post a fresh X image/text/quote link or a short TikTok video. Caitlyn should display `Shared by @sender` inside the card below its caption/source line (below the quoted text/source for a quote pair), preserve sender commentary without handled raw source URLs above the card, send the complete preview, then remove the original. Link-only posts should have no standalone attribution line. Check that `Original ↗` and the author open the correct source, image continuations are numbered, and text cards have no media filler. For quotes, verify the quoting author/text is on top, the quoted author/content is underneath, and no sharing/completion line interrupts the pair. Try several links and verify all are delivered before deletion; check video playback/audio on desktop and mobile. Failed/partial media must retain the source.
3. Edit or delete a source before cleanup and check stale previews are removed. Include an extra upload or a reply to confirm that source is preserved. Deleting an original as part of successful replacement must not delete Caitlyn's post, including after restart. Normal polling adds a short delay.
4. Run `/social disable` and post a fresh link to confirm no new preview is created. Re-enable only when wanted.
5. The owner has configured a private log destination with all types enabled. Confirm `/logs status` there; use `/logs levels types:all` only if desired. For a new setup, the bot owner runs `/setup logs channel:<private logs channel>` first. Keep it private; other servers must not receive these logs.

Do not stop PostgreSQL or simulate ambiguous live sends just to test failures; those cases have deterministic automated tests. Do not restart the homeserver bot while the Mac instance is active. No automated test messages were posted during preparation; the next actual message checks are the owner's manual test.

For a later restart, use the broker's actual private socket path in both terminals. Leave `.env` defaults unchanged:

```bash
LLM_ENABLED=false SOCIAL_MEDIA_ENABLED=true \
SOCIAL_WORKER_SOCKET=/path/to/private-directory/worker.sock \
LOG_LEVEL=INFO npm run dev
```

The broker must already be running as described above. When finished, use Ctrl+C in the bot terminal, then Ctrl+C in the worker terminal, and `colima stop caitlyn-media-test`. If these services were started by the assistant, ask it to stop the exact local test processes. No autostart was configured. Retain local DB test history for diagnosis; remove only the owned empty temporary socket directory after both processes have stopped.
