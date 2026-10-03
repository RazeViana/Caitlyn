# Mainframe transcription test instance

Prepared on 2026-10-03 (Europe/Amsterdam) as the TrueNAS custom app `caitlyn-test`, using the published `2.2.0` revision `2b3e1b7fc1da043db629d6a905d625fa3546618f`. Production `caitlyn` remains online. The owner selected a separate Discord bot in the existing server, with application ID `728643744726908989`, verified to differ from production.

Current checkpoint: the isolated database and GPU speech worker are healthy. The bot service is staged behind the `awaiting-discord-token` Compose profile until its separate token is saved and the server invitation is confirmed. No production token was copied into the test instance, no test bot has logged into Discord, and live voice reception still needs verification after activation.

## Layout and installed software

| Component | Version or location |
| --- | --- |
| Test bot image | `caitlyn-test:2.2.0-2b3e1b7`, `sha256:39a1311bbe3592e021e23becbbfef7c37649de315e30d1c8d499056e915015b3` |
| Bot runtime | Node 24.21.0, npm 11.19.0; 192 npm package entries including inherited global tools |
| Speech image | Reused `caitlyn-transcription:dev-base-en-cuda`, `sha256:47a23bc60c23f2506ebe573bd955f5128f4e436e9aaf488db61c71f0d6ae329f` |
| Speech engine/model | faster-whisper 1.2.1, CTranslate2 4.8.2, pinned English `base.en`; GTX 1070 with `cuda` / `int8_float32` |
| Test database image | Reused `pgvector/pgvector:0.8.1-pg17`, `sha256:5090c7fd921d75d8984233faaf8fb0d8ad18ddc38f912fd1261f9999b5d214a7` |
| Database | PostgreSQL 17.8 and pgvector 0.8.1; separate `caitlyn_test` database and role |
| Private deployment files | `/mnt/Datashare/apps/caitlyn-test`, root-owned, mode 0700 |
| Bot environment | `bot/bot.env`, UID/GID 1000, mode 0600 |
| Database files | `database/`, UID/GID 999, mode 0700 |
| Transcript files | `transcripts/`, UID/GID 1000, mode 0700; files created as 0600 |
| Token-entry helper | `set-discord-token.py` under the private deployment directory; source [configureTestBot.py](../scripts/transcription/configureTestBot.py) |

The [complete package inventory](caitlyn-test-installations.json) records every inspected package/version/path, including the reused GPU image and database OS packages. No TrueNAS host packages or GPU drivers were installed or changed. The token helper is a project script using the existing host Python, not an installed package.

The database and speech worker use the internal `ix-caitlyn-test_backend` network and publish no ports. Only the bot also joins the app's default network for Discord. All bind mounts are under the test directory; no production data mount is attached. Fresh migrations 001–016 initialized the empty test database. Social previews, AI replies and birthday reminders are disabled in this instance. Activity collected while testing goes only to its test database.

## Finish Discord setup

1. Enable Server Members Intent and Message Content Intent for the separate test application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. [Invite the test bot](https://discord.com/oauth2/authorize?client_id=728643744726908989&permissions=1051648&scope=bot%20applications.commands) to the existing server. Requested permissions are View Channels, Send Messages and Connect; administrators can restrict which voice channels it can view/connect to for a controlled test.
3. From Mainframe's host shell, run:

   ```sh
   sudo -n python3 /mnt/Datashare/apps/caitlyn-test/set-discord-token.py
   ```

   The hidden prompt accepts the new bot's token, verifies its application ID through Discord, and saves it atomically with private permissions. It refuses a token for another application and refuses HTTP redirects. Existing configuration is backed up privately first. `--token-file /path/to/private-file` is available when the token is already stored on Mainframe. Do not put a token in a command argument, this document, Git, or chat.

4. Before activation, verify the new bot's identity, server membership and required intents; save its existing guild command definitions and register the 15 commands from the test image for this application only. Global and production command definitions must remain unchanged.
5. Back up the saved test app configuration, then update only `caitlyn-test` through `app.update` with the prepared `compose.active.json`. This removes the staging profile. Wait for the TrueNAS job and bot startup to complete. Never edit the generated rendered Compose file.

## Checks and practical testing

The database schema, isolated database connection and live GPU HTTP service passed a test using the compiled bot's actual transcription client. An 11-second public speech fixture returned the expected text in 3.837 seconds, with SHA-256 `e4e644650803b9dca2d1caaf17fbfa3b5cd835a792b8d53d888c6996f7eb1c5d`. The probe made no Discord connection and printed no transcript text. The token helper passed synthetic checks for application mismatch, private atomic writes, recoverable backups, no token output and redirect rejection.

After activation, use a controlled voice conversation with two speakers and check `/transcribe status`, the recording notice, distinct speaker names/IDs and the daily text/JSONL files. Check join/leave, brief overlapping speech, `/transcribe stop` and `/transcribe resume`. English recognition stays local. As configured, automatic recording considers all ordinary voice channels in the existing server, one channel at a time; use `TRANSCRIPTION_CHANNEL_IDS` or Discord channel permissions to limit a test.

The test instance has a separate bot identity and persistent data, so production can stay online. A dedicated test server provides stronger isolation from normal server activity; [Discord recommends a server that is not actively used by others for development](https://docs.discord.com/developers/quick-start/getting-started#installing-your-app).

## Stop and recovery

Stop only `caitlyn-test` through the TrueNAS Apps UI or `app.stop`. Its database and transcripts persist under the test directory. Production needs no restart or configuration rollback because this deployment did not change it. Keep the saved image IDs and private configuration backups when changing the test instance. The production main-branch updater does not manage `caitlyn-test`.

To return to the staged configuration, update `caitlyn-test` through supported middleware using `compose.staged.json`. This stops the test bot while keeping its database and speech worker available. Preserve all database and transcript bind directories when removing the app; image/volume removal is a separate decision.
