# Mainframe transcription test instance

Activated on 2026-10-03 at 21:53 CEST (Europe/Amsterdam) as the TrueNAS custom app `caitlyn-test`. The current image uses local `2.2.0` revision `ca42123553b01ee5b0e237776286342fd8a4d230`, deployed at 23:01 CEST with Discord username attribution and formatted transcription command replies. Production `caitlyn` remains online. The owner selected a separate Discord bot in the existing server, with application ID `728643744726908989`, verified to differ from production. Its current global username is `SHUSH`, with no server nickname set at the latest check; this update did not change its Discord name.

Current checkpoint: all three test services are running, the isolated database and GPU speech worker are healthy, and the bot has logged into Discord. Its separate token, required intents and server membership were verified before activation. The 15 guild commands include `/transcribe`; global and production commands were left unchanged. Live recording saved 24 speech segments attributed to four Discord accounts. The owner stopped recording at 22:35:55 CEST, and the persisted pause remains in effect after the formatting update.

## Layout and installed software

| Component | Version or location |
| --- | --- |
| Test bot image | `caitlyn-test:2.2.0-ca42123`, `sha256:8a0866389947f65d6a84b2e13a9f4271df93eb9eab86b9779cd7fe8b8585acd6` |
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

## Discord configuration and recreation

These steps are complete for the running instance. Use them when recreating it or rotating its separate credentials.

1. Enable Server Members Intent and Message Content Intent for the separate test application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. [Invite the test bot](https://discord.com/oauth2/authorize?client_id=728643744726908989&permissions=1051648&scope=bot%20applications.commands) to the existing server. Requested permissions are View Channels, Send Messages and Connect; administrators can restrict which voice channels it can view/connect to for a controlled test.
3. From Mainframe's host shell, run:

   ```sh
   sudo -n python3 /mnt/Datashare/apps/caitlyn-test/set-discord-token.py
   ```

   The hidden prompt accepts the test bot's token, verifies its application ID through Discord, and saves it atomically with private permissions. It refuses a token for another application and refuses HTTP redirects. Existing configuration is backed up privately first. `--token-file /path/to/private-file` is available when the token is already stored on Mainframe. Do not put a token in a command argument, this document, Git, or chat. After rotating credentials for an active instance, restart only the test app through TrueNAS so it loads the new value.

4. Before activation, verify the new bot's identity, server membership and required intents; save its existing guild command definitions and register the 15 commands from the test image for this application only. Global and production command definitions must remain unchanged.
5. Back up the saved test app configuration, then update only `caitlyn-test` through `app.update` with the prepared `compose.active.json`. This removes the staging profile. Wait for the TrueNAS job and bot startup to complete. Never edit the generated rendered Compose file.

Activation job `226453` completed successfully. The previous TrueNAS app configuration, both prepared Compose configurations, deployment metadata, a consistent PostgreSQL custom-format dump and the production container baseline are saved privately under `/mnt/Datashare/apps/caitlyn-test/backups/activation-20261003T195227Z`. The original test guild command definitions and nickname are also backed up under `backups/`. Current operation and verification records are in `deployment.json` and `activation-verification.json` under the private deployment directory; they contain no token values.

Command-formatting update job `226633` completed successfully at 22:49 CEST. It changed only the test bot image in the saved app configuration. The previous configuration, database dump and a consistent copy of the paused transcript store are under `backups/command-formatting-20261003T204319Z`. Restoring that directory's `truenas-app-config.json` through `app.update` restores the previous bot image, `sha256:39a1311bbe3592e021e23becbbfef7c37649de315e30d1c8d499056e915015b3`. Existing transcripts and their pause setting remain in place. The new source revision is committed locally; it has not been pushed to GitHub.

Username-attribution update job `226677` completed successfully at 23:01 CEST. New speech, join and leave records use Discord account usernames and stable user IDs, rather than server nicknames or global display names. Earlier records remain as originally captured. The previous configuration, database dump and paused transcript store are under `backups/username-labels-20261003T205652Z`; restore its `truenas-app-config.json` through `app.update` to return to image `sha256:bc0c7beb1b8cbd00c4110b62cf9f6bc00b2412aada0f4f49e5d54772f0b820ab`. The current source revision is committed locally and has not been pushed.

## Checks and practical testing

The database schema, isolated database connection and live GPU HTTP service passed a test using the compiled bot's actual transcription client. An 11-second public speech fixture returned the expected text in 3.837 seconds, with SHA-256 `e4e644650803b9dca2d1caaf17fbfa3b5cd835a792b8d53d888c6996f7eb1c5d`. The probe made no Discord connection and printed no transcript text. The token helper passed synthetic checks for application mismatch, private atomic writes, recoverable backups, no token output and redirect rejection.

The activation check confirmed Discord login, a connected and undeafened voice state, the recording notice, GPU health (`cuda` / `int8_float32`), writable transcript storage and private file permissions. Four participant join records, a session-start record and a live speech transcript were present at the initial check; conversation content was not printed. All test bind mounts are under the test directory, and no test service publishes a host port. The production bot, broker, FxEmbed and database retained their container IDs, images and start times through activation. Startup had no errors; warnings only described deliberately unconfigured optional features.

The saved speech record has a nonempty speaker name, a user ID matching a joined participant and the correct Europe/Amsterdam daily filename. Both JSONL and readable text files exist with mode 0600. The final `npm run check` passed type checking, lint, build and 424 tests; the optional PostgreSQL integration suite was skipped. No test service restarted unexpectedly during activation verification.

The owner's subsequent test from 22:34:41 to 22:35:53 CEST saved 11 speech segments from four separate Discord accounts. The complete session has 24 speech segments and no recorded recognition-failure or dropped-audio gap records. Speaker identities and capture timestamps are present; word-for-word accuracy still depends on comparing the text with what participants actually said, because raw audio is not retained. Private transcript content is not included in this repository.

The formatting update passed the same full quality gate. All four compiled command actions produced private status cards in a synthetic smoke check, and the deployed JavaScript hashes match the checked build. The container package inventory is unchanged apart from the bot image ID. The GPU worker remains on `cuda` / `int8_float32`; saved transcript files and settings have identical hashes before and after deployment. Production container IDs, images and start times also remained unchanged. The update required no command registration because command definitions did not change.

The username change also passed the full quality gate: 424 tests passed, with the optional PostgreSQL suite skipped. The speaker lifecycle fixture now gives each account different usernames, nicknames and global display names, and verifies username attribution for all participant records. The running container's compiled runtime matches the checked build. The database and GPU worker are healthy, recording remains paused, saved logs retain their original hashes, and production containers remained unchanged. Package versions are unchanged.

Use a controlled voice conversation with two speakers and check `/transcribe status`, the recording notice, distinct speaker names/IDs and the daily text/JSONL files. Check join/leave, brief overlapping speech, `/transcribe stop` and `/transcribe resume`. English recognition stays local. As configured, automatic recording considers all ordinary voice channels in the existing server, one channel at a time; use `TRANSCRIPTION_CHANNEL_IDS` or Discord channel permissions to limit a test.

The test instance has a separate bot identity and persistent data, so production can stay online. A dedicated test server provides stronger isolation from normal server activity; [Discord recommends a server that is not actively used by others for development](https://docs.discord.com/developers/quick-start/getting-started#installing-your-app).

## Stop and recovery

Stop only `caitlyn-test` through the TrueNAS Apps UI or `app.stop`. Its database and transcripts persist under the test directory. Production needs no restart or configuration rollback because this deployment did not change it. Keep the saved image IDs and private configuration backups when changing the test instance. The production main-branch updater does not manage `caitlyn-test`.

To return to the staged configuration, update `caitlyn-test` through supported middleware using `compose.staged.json`. This stops the test bot while keeping its database and speech worker available. Preserve all database and transcript bind directories when removing the app; image/volume removal is a separate decision.
