# Local voice transcription

Caitlyn can automatically transcribe conversations in the configured server's ordinary voice channels. There is no participant opt-in step. The bot appears in the voice channel, posts a recording notice in its text chat, and saves speaker-labelled daily logs on Mainframe. These logs also include recorded participants' voice activity and messages posted in channels Caitlyn can see in the same server, including message text and links. They are not posted to Discord or fed into the existing AI chat/memory system.

Each Discord user's audio stream is transcribed separately. New speaker labels use the account's Discord username (`user.username`) and stable Discord user ID, including when people talk over each other. Server nicknames and global display names are not used. This identifies the Discord account transmitting audio; it cannot distinguish multiple people sharing one microphone.

## Recording behavior

- `TRANSCRIPTION_CHANNEL_IDS=*` considers all ordinary voice channels in `GUILD_ID`. Stage channels and bots are excluded. A comma-separated channel allowlist is also supported.
- Caitlyn records **one channel at a time**. It keeps the current conversation until that channel has no human members, then chooses another occupied channel by server channel order. Simultaneous conversations in other channels are not captured. Covering them requires additional bot identities/instances, each with separate tokens and transcript directories.
- Already occupied channels are discovered at startup. Existing occupants receive `present` records. Actual joins and leaves receive timestamped `joined`/`left` records with usernames, user IDs and voice-channel names/IDs; channel moves include the other channel. Fast joins and leaves are handled directly from gateway events. If membership must be reconciled from the channel cache, departure records explain that the exact leave time is unavailable. New speakers get their own streams, and departing speakers' pending audio is flushed. Reconnection uses a 15-second backoff and writes a gap notice.
- The bot requires View Channel, Connect and Send Messages in each candidate voice channel. GuildVoiceStates is already enabled in the bot. It joins muted but **not deafened**. Server-deafening the bot interrupts capture.
- `/transcribe stop` stops capture and participant activity logging and saves a paused setting that survives restarts. Previously received audio may finish transcription. Stopping, pausing or reconnecting ends the recording session without falsely logging that everyone left the voice channel. `/transcribe resume` clears the paused setting. `/transcribe start` prioritizes the administrator's current channel; stop an existing recording before selecting another one.
- All command actions require Administrator permission. Commands are guild-only, and runtime access is restricted to the configured `GUILD_ID`. Status never exposes transcript content. `/transcribe exclude channel:` and `/transcribe include channel:` persist channel exclusions without editing environment files; including a channel cannot expand the operator's allowlist. Excluding an active channel ends its recording.

Command replies are private Discord cards with separate recording state, speech-processing counters and daily-log information. Start, resume and stop show an action-specific title; the status distinguishes connecting, recording, waiting and paused. Failed/dropped counts cover the current bot process and reset when it restarts. Replies include the appropriate pause/resume command and explain that pauses persist across restarts.

## Participant activity

Activity belongs to the same daily voice-channel log as the conversation. It covers people currently in that recorded voice channel, while recording is enabled:

- Message posts include the Discord username/user ID, creation timestamp, full original text, message ID/link, and the destination channel name/ID. Thread and forum messages include the parent channel when available. Attachment filenames are listed; attachment contents are not downloaded.
- Mute/unmute, deafen/undeafen, server mute/deafen, camera on/off and screen-sharing changes are recorded as voice activity.
- Messages from people outside the recorded channel, other servers, DMs, bots, webhooks and system messages are excluded. Delayed messages created before the recording session or the participant's arrival are excluded. Recently repeated message-create events are deduplicated within the session.

Posts, observed edits and deletions use separate append-only events. An edit's audience is the intersection of the original post's audience, people present at the edit, and current source-channel permissions. A rejoining participant may see later edits but cannot see edits made during their absence. Deletes contain no copied message body and are deduplicated, including bulk deletes. This covers the most recent 2,048 recorded posts in the current session while their authors remain present; uncached partial edits, changes during downtime/pauses and previous sessions cannot be reconstructed. Original text remains in the archive. No history, reactions, typing or presence is backfilled. Existing Discord gateway intents cover this feature.

`/transcribe correct event: text:` appends an audited speech correction with the original event ID, editor's Discord username/ID and timestamp. The original remains unchanged. The administrator must have been in that speech entry's recorded audience; administrator permission does not override attendance. Corrections keep the original audience and do not masquerade as newly spoken words.

## Files and retention

The optional [PostgreSQL archive](transcript-database.md) makes these events searchable while preserving the files as a durable local log. New records include stable event IDs and capture-time viewer IDs. Speech is split whenever membership changes; the database's member reader limits every result to its recorded audience. Historical records without verified audiences stay operator-only. Apply migrations `017` and `018` and set `TRANSCRIPTION_DATABASE_ENABLED=true` to enable replay.

Set `TRANSCRIPTION_DIRECTORY` to a writable persistent volume. Paths are:

```text
<directory>/settings.json
<directory>/<guild-id>/<voice-channel-id>/2026-10-01.jsonl
<directory>/<guild-id>/<voice-channel-id>/2026-10-01.txt
```

JSONL is the authoritative append-only record, with UTC capture timestamps, channel and session identities, speaker usernames/IDs, transcript text, and session/presence/join/leave/activity/gap events. `message_posted` records keep the voice channel as `channelId` and the post destination in `activityChannelId`/`activityChannelName`, with optional parent-channel details, `messageId`, `messageUrl`, `attachmentNames` and the original body in `text`. Older entries retain their originally captured labels and lifecycle semantics. Each completed append is flushed to disk. The text file is a readable view with the local time and UTC offset; message newlines and control characters become spaces so each event stays on one line, while JSONL retains the full original text. Entries are appended as work completes; use the JSONL `at` timestamp when reconstructing chronological order across speakers and lifecycle events. Each chunk belongs to its capture date, even if inference finishes after midnight. The default daily boundary is `Europe/Amsterdam`, including daylight-saving changes.

New directories use mode `0700`; new files use `0600`. Provision the parent bind mount with the bot's container UID and private permissions. Retention defaults to indefinite. `/transcribe retention days:90 confirm-deletion:true` explicitly enables hourly cleanup of complete local days older than that duration, including database rows, JSONL, TXT and quarantine copies. `days:0` disables future cleanup. A durable database fence prevents replay from resurrecting expired records. Cleanup requires the archive and commits its database deletion before removing files; failed cleanup retries. Backups have independent retention and are not deleted by this command. Do not place actual transcripts in the repository: `transcripts/` is excluded from Git and image build contexts.

Raw audio is held in bounded memory buffers and discarded after recognition. It is **not saved for retry**. Speech is split at pauses, approximately 20 seconds, local midnight, or speaker departure. Short pauses are not precisely reconstructed. The local model can mishear speech or produce inaccurate text; these are transcripts, not verified quotations.

The inference backlog is capped at 32 pending chunks. Overload, recognition failures and interrupted shutdown work produce gap records, with counts in `/transcribe status`. A full/unwritable log volume pauses recording. Repair storage and restart Caitlyn after a storage failure. Crashes can lose buffered speech and in-flight recognition; previous completed JSONL records remain. An unclosed recording marker produces an operator-only restart gap without guessing membership. The writer separates a crash tail from the next record. The importer durably quarantines malformed entries before advancing, sanitizes PostgreSQL-incompatible NUL/unpaired-surrogate text in the database copy, and continues other channels. The original bytes remain in private files. Earlier conversations from before recording began cannot be recovered.

## Operations and shared logging

Transcription uses Caitlyn's existing `logger`, `logData`, server context, console filtering and private Discord forwarder. INFO records administrator actions, settings and session endings; SUCCESS records successful recording starts and recovered health; WARN records capture, archive, disk, backup or recognition problems. DEBUG records saved event IDs, usernames, lengths and periodic health summaries. No speech, posted message text, correction text or attachment filenames are forwarded. `/logs levels` still controls delivery independently of console `LOG_LEVEL`; selecting only INFO hides WARN/SUCCESS from Discord.

Every 30 seconds the recorder checks Discord readiness, eligible-channel capture, storage, disk space (warning below 1 GiB), local worker health, queue pressure and stalled imports. State changes and recovery produce bounded alerts, with reminders every 15 minutes while a problem continues. Silence alone is not a receive failure. `health.json` is a private heartbeat; sampled cumulative loss counters survive a restart, while the exact loss intervals remain in gap events. Container health can run `node scripts/transcription/healthcheck.mjs`; a stale heartbeat or failed dependency is unhealthy. Health status alone cannot prove speech recognition quality. The worker also reports unhealthy if an inference request is stuck for more than 75 seconds.

Configured PostgreSQL startup failures no longer prevent Discord login or file recording. Startup probes and background archive work retry. Existing database-dependent features retain their own failure behavior; activity missed by those features is not reconstructed from transcripts.

`scripts/transcription/backup.py --config /protected/backup.json` runs on Mainframe with the existing Python/TrueNAS/Docker tools. Its private JSON specifies `app`, database `container`, `role`, `database`, `transcripts`, `destination`, and optional absolute `privateFiles`. Each run saves the TrueNAS configuration, a consistent custom-format PostgreSQL dump, initial file extents with hashes, and private configuration copies. It then restores the dump into a disposable isolated PostgreSQL container using the same image, verifies transcript row security and file checkpoints, removes that container and records success in `backup-status.json`. No host packages or production database are changed by verification. Interrupted or failed backups never report success. Backups are retained indefinitely by default.

Schedule this script once daily using supported TrueNAS cron middleware, with stdout/stderr email disabled and protected script/config paths. Set `TRANSCRIPTION_BACKUP_MONITOR=true` only after installing the schedule. Missing, failed, or more than 36-hour-old verified backups then alert through the normal bot logger. This is a local recovery copy, not protection against loss of the entire storage pool. Restore to a private location, restore the database, preserve replay fences, reset only necessary checkpoints, apply configured retention before member access, and point a stopped bot at the recovered files. Never expose a backup directly to a website.

## Local speech worker

The worker under `scripts/transcription/` uses faster-whisper 1.2.1 with the English `base.en` model. The default image and Compose configuration use Mainframe's NVIDIA GPU with `int8_float32` inference. An explicit CPU configuration is also available. Model weights are downloaded **while building the image**. The image pins the model revision and Python package versions. Runtime loads only local model files, enables offline mode, and needs no API key or paid service. The supplied Compose network is internal and publishes no host port; requests and audio remain on Mainframe.

Build and start this worker as its own stack during activation:

```sh
docker compose -f scripts/transcription/compose.yaml build
docker compose -f scripts/transcription/compose.yaml up -d
```

This creates the internal Docker network `caitlyn-transcription`. Attach **only the bot** to it while preserving the bot's current default network. Its endpoint is then `http://transcription:8095/transcribe`. The worker's `GET /health` responds only after the model loads and reports the selected `device` and `compute_type`. The worker has a read-only root filesystem, no Docker socket, two CPUs and a 1 GiB memory limit. Python libraries are installed inside the image, not on TrueNAS. The bot uses `@discordjs/voice` for encrypted voice reception and `opusscript` for direct PCM decoding; no host FFmpeg installation is required.

### NVIDIA GPU configuration

Mainframe's GTX 1070 has 8 GiB of VRAM and supports `int8_float32` inference. The default Compose file exposes one selected GPU to the speech worker only. It keeps the same English model, memory-only audio handling, private network and daily log behavior. No extra GPU override file is needed.

Use the GPU option for Mainframe: the same 11-second test clip took a median **0.284 seconds on GPU versus 1.909 seconds on CPU** after initialization, about 6.7 times faster, with identical transcript hashes. The first GPU request took 16.942 seconds to initialize libraries. This measures one clean speech sample, not conversation accuracy or total concurrent-speaker capacity. The CPU option remains available for rollback and machines without NVIDIA GPUs.

`TRANSCRIPTION_GPU_ID` selects the Docker-visible GPU (default `0`; a GPU UUID can also be used). It is a Compose environment variable, not a setting in the bot's `.env`. The worker uses `TRANSCRIPTION_DEVICE=cuda` and `TRANSCRIPTION_COMPUTE_TYPE=int8_float32`. CPU threads are independently configurable through `TRANSCRIPTION_CPU_THREADS` (1–32; default 2). Invalid or unsupported device/precision settings fail startup; the worker does not silently switch devices.

For an explicit CPU deployment, use the standalone CPU file **instead of** the GPU file:

```sh
docker compose -f scripts/transcription/compose.cpu.yaml up -d --build
```

This selects the Dockerfile's `cpu` target and `cpu`/`int8` settings with no GPU device request. Keep the same Compose project name when switching an existing stack, so it replaces that worker. A plain `docker build scripts/transcription` now selects the final `cuda` stage; CPU builds require `--target cpu`.

The GPU image adds cuBLAS 12.8.4.1 and cuDNN 9.10.2.21 **inside the container**. The existing TrueNAS NVIDIA driver/runtime is reused. These library versions retain Pascal compatibility; do not blindly replace them with a current cuDNN package that has dropped support for this GPU. See [NVIDIA's cuDNN 9.10 support matrix](https://docs.nvidia.com/deeplearning/cudnn/backend/v9.10.2/reference/support-matrix.html) and [CTranslate2 compute types](https://opennmt.net/CTranslate2/quantization.html). GPU access is shared with other host workloads rather than reserved exclusively; recheck usage before activation.

Configuration in the bot environment:

```dotenv
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_ENDPOINT=http://transcription:8095/transcribe
TRANSCRIPTION_DIRECTORY=/var/lib/caitlyn/transcripts
TRANSCRIPTION_CHANNEL_IDS=*
TRANSCRIPTION_LANGUAGE=en
TRANSCRIPTION_TIMEZONE=Europe/Amsterdam
```

`GUILD_ID` selects the server. The endpoint accepts local HTTP addresses or Docker service names and refuses credentials, public hostnames and redirects. POST PCM16 mono 16 kHz WAV to `/transcribe?language=en` to receive text and `recognition` metadata: model, language, audio/processing duration, segment offsets, average log probability and no-speech probability. These scores are diagnostic signals, not accuracy percentages. Segment offsets refer to the submitted PCM; they do not reconstruct wall-clock silence. Older text-only worker responses remain supported. Public Discord voice traffic still uses the bot's normal Discord connection.

Changing language to `auto`/`nl` also requires rebuilding with an appropriate **multilingual** model and its matching `WHISPER_MODEL_REVISION`; `base.en` is English-only. Do not expect changing the language variable alone to change the image's model.

## Mainframe activation and rollback

For testing with a separate Discord identity and database while production stays online, use the [caitlyn-test instance](caitlyn-test.md).

This feature branch does not activate recording on the running bot. The existing bot is TrueNAS-managed; edit its saved custom Compose configuration through supported TrueNAS middleware, never the generated rendered YAML. Preserve its existing image, credentials, mounts, databases and networks, and back up that configuration before activation.

1. Build the feature bot image and the separate local speech-worker image. Keep the existing bot image digest and saved app configuration for rollback. Keep the worker in its own stack: the automatic updater currently expects exactly the three existing services in the Caitlyn app.
2. Provision a private persistent transcript directory, for example `/mnt/Datashare/apps/caitlyn-transcripts`, writable by the verified runtime UID/GID (the repository's deployment generator uses `1000:1000`; recheck the live app).
3. Mount that directory read/write at `/var/lib/caitlyn/transcripts`. Keep the bot's other read-only mounts and default network. Add `caitlyn-transcription` as an **external** network and connect the bot to both `default` and that network. The worker stays on its internal network only.
4. Back up and apply only missing migrations `017`/`018`, enable database replay, add the settings above and a recorder healthcheck, then replace the bot image and restart through TrueNAS. Run only one instance for the bot token. Register the updated guild commands separately using the new bot image. Install and verify daily backups before enabling backup monitoring. Review the migration fingerprint before allowing the production updater to accept the release.
5. Confirm worker health, `/transcribe status`, the channel recording notice, and a real conversation with two speakers. Check speaker names/IDs, timestamps and saved files. Also check existing activity/social commands after the restart.

To roll back, restore the saved TrueNAS app configuration, environment and previous bot/worker image digests. Preserve transcript files, expanded event types and archive tables; do not reverse the database migration or restore an old dump over new user activity. Disable replay if returning to a version that cannot understand revision events. Set `TRANSCRIPTION_ENABLED=false` to disable recording without reverting the image. The saved `/transcribe stop` state is an independent recording pause. The mainframe updater copies existing service mounts/environment/networks when changing image IDs, so retain the separately managed worker and persistent storage/network configuration during future updates.

## Verification

`npm run check` includes transcript/configuration/audio/queue/lifecycle/command tests and the local worker HTTP tests (Python 3 is needed for the latter). Tests use synthetic Discord clients and temporary directories, with no live token or production database. The Opus test exercises a real encoder/decoder. The worker can be tested with a public speech fixture in a disposable container using `--network none`, which verifies that inference works without external access.

`scripts/transcription/benchmark.py` exercises the actual HTTP handler four times by default with a supplied local speech file (up to 20 seconds); `--repeats 120` runs an accelerated load check. It reports timings, the warm median, total processed audio duration and a transcript hash without printing conversation text. For a CUDA image and a fixture already placed in `/path/to/fixtures`:

```sh
docker run --rm -i --network none --gpus device=0 --cpus 2 --memory 1g \
  --read-only --tmpfs /tmp:size=16m -v /path/to/fixtures:/fixtures:ro \
  --entrypoint python caitlyn-transcription:base-en-cuda \
  - /fixtures/sample.wav < scripts/transcription/benchmark.py
```

To compare CPU, use the CPU image and omit `--gpus`. Keep model, fixture, resource limits and recognition parameters identical. The benchmark requires no Discord connection or transcription logs.

Discord does not officially document audio reception, so library compatibility needs a real-channel check after Discord voice changes. See the upstream [voice library](https://discordjs.dev/docs/packages/voice/main), [speaker receiver API](https://discordjs.dev/docs/packages/voice/main/VoiceReceiver:Class), and [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Installed versions and development image details are recorded in [the installation inventory](voice-transcription-installations.md).
