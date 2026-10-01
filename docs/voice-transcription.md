# Local voice transcription

Caitlyn can automatically transcribe conversations in the configured server's ordinary voice channels. There is no participant opt-in step. The bot appears in the voice channel, posts a recording notice in its text chat, and saves speaker-labelled daily logs on Mainframe. It does not post transcripts to Discord or feed them into the existing AI chat/memory system. Text-channel archiving is not included in this feature.

Each Discord user's audio stream is transcribed separately. Speaker names come from their server display name and their stable Discord user ID, including when people talk over each other. This identifies the Discord account transmitting audio; it cannot distinguish multiple people sharing one microphone.

## Recording behavior

- `TRANSCRIPTION_CHANNEL_IDS=*` considers all ordinary voice channels in `GUILD_ID`. Stage channels and bots are excluded. A comma-separated channel allowlist is also supported.
- Caitlyn records **one channel at a time**. It keeps the current conversation until that channel has no human members, then chooses another occupied channel by server channel order. Simultaneous conversations in other channels are not captured. Covering them requires additional bot identities/instances, each with separate tokens and transcript directories.
- Already occupied channels are discovered at startup. New speakers get their own streams. Departing speakers' pending audio is flushed. Reconnection uses a 15-second backoff and writes a gap notice.
- The bot requires View Channel, Connect and Send Messages in each candidate voice channel. GuildVoiceStates is already enabled in the bot. It joins muted but **not deafened**. Server-deafening the bot interrupts capture.
- `/transcribe stop` immediately stops capture and saves a paused setting that survives restarts. Previously received audio may finish transcription. `/transcribe resume` clears that setting. `/transcribe start` prioritizes the administrator's current channel; stop an existing recording before selecting another one.
- All four command actions require Administrator permission. Commands are guild-only, and runtime access is restricted to the configured `GUILD_ID`. Commands never expose transcript content.

## Files and retention

Set `TRANSCRIPTION_DIRECTORY` to a writable persistent volume. Paths are:

```text
<directory>/settings.json
<directory>/<guild-id>/<voice-channel-id>/2026-10-01.jsonl
<directory>/<guild-id>/<voice-channel-id>/2026-10-01.txt
```

JSONL is the authoritative append-only record, with UTC capture timestamps, channel and session identities, speaker display names/IDs, transcript text, and session/join/leave/gap events. Each completed append is flushed to disk. The text file is a readable view with the local time and UTC offset. Entries are appended as work completes; use the JSONL `at` timestamp when reconstructing chronological order across speakers and lifecycle events. Each chunk belongs to its capture date, even if inference finishes after midnight. The default daily boundary is `Europe/Amsterdam`, including daylight-saving changes.

New directories use mode `0700`; new files use `0600`. Provision the parent bind mount with the bot's container UID and private permissions. The code does not change permissions on an existing directory. Files remain until an operator removes them; there is no automatic retention deletion. Back up transcripts according to the desired retention policy. Do not place actual transcripts in the repository: `transcripts/` is excluded from Git and image build contexts.

Raw audio is held in bounded memory buffers and discarded after recognition. It is **not saved for retry**. Speech is split at pauses, approximately 20 seconds, local midnight, or speaker departure. Short pauses are not precisely reconstructed. The local model can mishear speech or produce inaccurate text; these are transcripts, not verified quotations.

The inference backlog is capped at 32 pending chunks. Overload, recognition failures and interrupted shutdown work produce gap records, with counts in `/transcribe status`. A full/unwritable log volume pauses recording. Repair storage and restart Caitlyn after a storage failure. Crashes can lose buffered speech and in-flight recognition; previous completed JSONL records remain. A partial final line after an abrupt host failure should be ignored during offline analysis. Earlier conversations from before recording began cannot be recovered.

## Local speech worker

The worker under `scripts/transcription/` uses faster-whisper 1.2.1 with the English `base.en` model, int8 CPU inference and two CPU threads. Model weights are downloaded **while building the image**. The image pins the model revision and Python package versions. Runtime loads only local model files, enables offline mode, and needs no API key or paid service. The supplied Compose network is internal and publishes no host port; requests and audio remain on Mainframe.

Build and start this worker as its own stack during activation:

```sh
docker compose -f scripts/transcription/compose.yaml build
docker compose -f scripts/transcription/compose.yaml up -d
```

This creates the internal Docker network `caitlyn-transcription`. Attach **only the bot** to it while preserving the bot's current default network. Its endpoint is then `http://transcription:8095/transcribe`. The worker's `GET /health` responds only after the model loads. The worker has a read-only root filesystem, no Docker socket, two CPUs and a 1 GiB memory limit. Python libraries are installed inside the image, not on TrueNAS. The bot uses `@discordjs/voice` for encrypted voice reception and `opusscript` for direct PCM decoding; no host FFmpeg installation is required.

Configuration in the bot environment:

```dotenv
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_ENDPOINT=http://transcription:8095/transcribe
TRANSCRIPTION_DIRECTORY=/var/lib/caitlyn/transcripts
TRANSCRIPTION_CHANNEL_IDS=*
TRANSCRIPTION_LANGUAGE=en
TRANSCRIPTION_TIMEZONE=Europe/Amsterdam
```

`GUILD_ID` selects the server. The endpoint accepts local HTTP addresses or Docker service names and refuses credentials, public hostnames and redirects. This is a local worker protocol: POST PCM16 mono 16 kHz WAV to `/transcribe?language=en`, receive `{ "text": "..." }`. It is not a cloud API adapter. Public Discord voice traffic still uses the bot's normal Discord connection.

Changing language to `auto`/`nl` also requires rebuilding with an appropriate **multilingual** model and its matching `WHISPER_MODEL_REVISION`; `base.en` is English-only. Do not expect changing the language variable alone to change the image's model.

## Mainframe activation and rollback

This feature branch does not activate recording on the running bot. The existing bot is TrueNAS-managed; edit its saved custom Compose configuration through supported TrueNAS middleware, never the generated rendered YAML. Preserve its existing image, credentials, mounts, databases and networks, and back up that configuration before activation.

1. Build the feature bot image and the separate local speech-worker image. Keep the existing bot image digest and saved app configuration for rollback. Keep the worker in its own stack: the automatic updater currently expects exactly the three existing services in the Caitlyn app.
2. Provision a private persistent transcript directory, for example `/mnt/Datashare/apps/caitlyn-transcripts`, writable by the verified runtime UID/GID (the repository's deployment generator uses `1000:1000`; recheck the live app).
3. Mount that directory read/write at `/var/lib/caitlyn/transcripts`. Keep the bot's other read-only mounts and default network. Add `caitlyn-transcription` as an **external** network and connect the bot to both `default` and that network. The worker stays on its internal network only.
4. Add the settings above to the persistent bot environment, replace only the bot image, and restart the app through TrueNAS. Run only one instance for the bot token. Register the updated guild commands separately using the new bot image.
5. Confirm worker health, `/transcribe status`, the channel recording notice, and a real conversation with two speakers. Check speaker names/IDs, timestamps and saved files. Also check existing activity/social commands after the restart.

To roll back, restore the saved TrueNAS app configuration and previous bot image digest. Preserve the transcript directory; there is no database migration to undo. Set `TRANSCRIPTION_ENABLED=false` to disable this feature without reverting the image. The saved `/transcribe stop` state is an independent recording pause. The mainframe updater copies existing service mounts/environment/networks when changing image IDs, so retain the separately managed worker and persistent storage/network configuration during future updates.

## Verification

`npm run check` includes transcript/configuration/audio/queue/lifecycle/command tests and the local worker HTTP tests (Python 3 is needed for the latter). Tests use synthetic Discord clients and temporary directories, with no live token or production database. The Opus test exercises a real encoder/decoder. The worker can be tested with a public speech fixture in a disposable container using `--network none`, which verifies that inference works without external access.

Discord does not officially document audio reception, so library compatibility needs a real-channel check after Discord voice changes. See the upstream [voice library](https://discordjs.dev/docs/packages/voice/main), [speaker receiver API](https://discordjs.dev/docs/packages/voice/main/VoiceReceiver:Class), and [faster-whisper](https://github.com/SYSTRAN/faster-whisper). Installed versions and development image details are recorded in [the installation inventory](voice-transcription-installations.md).
