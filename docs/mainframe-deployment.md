# Mainframe deployment

For ongoing main-branch updates, use [automatic deployment](automatic-deployment.md). The image IDs and checks below record the initial manual rollout, not the latest registry release.

## Approved rollout: original database (2026-09-18)

The owner approved deployment and selected the **original mainframe database**. The older assessment below is historical. No local activity, birthday records or counters were copied over it. Parked Reddit source is excluded from the production images; `main` remains unchanged.

**Activated:** TrueNAS app update 156789 succeeded. `ix-caitlyn-caitlyn-1` connected to PostgreSQL, loaded 14 commands/8 events, logged into Discord at **21:45:56 UTC** and finished startup at 21:45:57 UTC. Bot restart count was zero and AI was disabled. Broker/FxEmbed and the original database were healthy. The local bot/broker were confirmed stopped before activation. The preceding clean media stop/start (jobs 156781/156782) succeeded without leftover worker resources. This verifies application restart, not a full mainframe reboot.

A read-only probe from inside the running bot confirmed database `caitlyn`, 10 birthdays, zero logging/social configuration rows, AI off, and HTTP 200/idle for its mounted worker socket with platforms X/TikTok/Instagram. No second Discord login or test message was created by that probe.

### Database protection and verified migration

- Started only the existing `caitlyn-discord-bot-db` app initially; actual PostgreSQL version is 17.8, database `caitlyn`, port 5433. No database image upgrade or replacement data directory.
- Created ZFS snapshot `Datashare/apps/caitlyn-discord-bot-db@caitlyn-v3-predeploy-20260918T2056Z` before starting the database.
- Saved the previous app definitions/environment and a custom-format database dump in private, ignored local directory `backups/mainframe-predeploy-mzRkPm`. Files are mode 0600 under a 0700 directory. Do not publish these files: they contain credentials and user data.
- Dump: 248,501 bytes, SHA-256 `02cdeb5e733ead14de515657bd9b42f81dfc992a2fe641d7b3c6ed32fa20f146`. Successfully restored to an isolated temporary local database, tested the migrations, then removed only that temporary database.
- Original counts: birthdays 10; daily activity 1,319; messages 34; user activity 16; voice sessions 1,914. Every original row's UTC-normalized fingerprint matched before and after production migrations **010–016**, inside one locked transaction. Migration 009 was already present; 001–008 were not replayed. Voice comparison excludes only the newly added `needs_reconciliation` field; no historical durations/timestamps were invented or deleted.
- The initial preservation precheck rolled back before migration because the comparison sessions used different timezones. Normalizing both sessions to UTC fixed the check; a fresh restore verification preceded the successful production transaction.

### Services and credentials

TrueNAS custom app `caitlyn` uses separately pinned bot, broker and FxEmbed images. The broker starts bounded disposable media containers. The old Watchtower service/opt-in and mutable `latest` image have been removed from this app's definition. No media/API ports are published. Bot activation is a separate explicit `activateBot: true` step in `scripts/deployment/compose.mjs`; default configuration starts media services only.

Runtime root: `/mnt/Datashare/apps/caitlyn-discordbot/runtime-v3-20260918-1`. Root is mode 0700; each mounted subdirectory is owned by container UID/GID 1000, mode 0700, and its secret files are mode 0600. Bot environment, broker API key and FxEmbed X configuration have separate mounts. The bot has neither Docker access nor X credentials. Only the trusted broker receives the powerful host Docker socket; a read-only socket mount does **not** make the Docker API read-only.

FxEmbed binds only to loopback in its container; the broker shares that network namespace. Mounted X configuration is loaded on every container startup without 1Password or an interactive Mac session. The encrypted payload and decryption key are co-located: file permissions and mount isolation provide the access boundary, not independent encryption-at-rest. Expired/revoked X sessions still require owner renewal. Never print/copy these files into Git, Docker environment fields or command arguments. The old server `.env` contents were preserved and its permissions tightened from 0775 to 0600.

AI is explicitly off; social processing is enabled at service level but remains opt-in per Discord channel. Birthday timezone is Europe/Amsterdam. Existing Discord token/client/guild identity was verified without displaying values. Original-database logging/social settings are initially empty; transferring the local configuration requires the owner's separate choice. Commands remain `/setup logs`, `/logs levels`, and `/social enable`.

### Pinned release images

| Component | Local release tag | Image ID |
| --- | --- | --- |
| Bot | `caitlyn-bot:bcde78a-deploy3` | `sha256:7db24b7bb722e51de9eb5ee4bb6f6fc476f5795ce4c2d4b37b5a00069ddd88a0` |
| Broker | `caitlyn-broker:bcde78a-deploy3` | `sha256:26f8c69d0671e9003edf1d7e02ea2655f762b0d822dbbfcfb661e74a4235c519` |
| FxEmbed | `caitlyn-fxembed:bcde78a-deploy3` | `sha256:dcde39a1f1097202527e049bca2a839e9c006cceb3ab46bdbe10075754433203` |
| Media | `caitlyn-media:bcde78a-deploy3` | `sha256:48f4e7303bb740b28e85e0c5d29bab2db07f3d7dbea323cc87224b4e21d60fdd` |

AMD64 contexts were assembled from exact published commit `bcde78a` plus allowlisted deployment overlays, never the dirty development source. Final server context: `/mnt/Datashare/apps/caitlyn-discordbot/deployments/20260918-bcde78a-3`. Images are local, with `pull_policy: never`; they were not pushed to a registry. See [the complete installation list](mainframe-installations.md). **No host packages were installed** on either Mac or TrueNAS.

### Checks and operation

Deployment tests cover private configuration files, permission/symlink rejection, closed errors, stale/live socket handling, service isolation and verified-backup enforcement. The full development checkout passed 443 tests plus one optional PostgreSQL skip, typecheck, lint and build. The clean published snapshot plus initial deployment tests passed 399 tests plus one skip. Production images passed non-root module import checks; all 10 offline Instagram fixtures passed. A bot-image probe connected to the original database without logging into Discord and confirmed AI off. Existing guild registration already contains all 14 commands and the updated Instagram `/social` description; no registration change was necessary.

The broker only removes a provably stale, private, owned Unix socket after checking there is no listener. Uncertain sockets and orphaned worker containers/volumes fail closed for operator review. Do not broadly prune Docker resources or delete a live socket. Service health checks are local, not a guarantee of upstream X/Instagram/TikTok availability. Restart only the `caitlyn` app; do not reboot the mainframe or affect unrelated apps for a bot rollout.

Live mainframe checks, without Discord test messages: X video and the previously restricted X example returned verified video; both owner-supplied Instagram photo/reel examples returned complete media. After restarting, authenticated X returned 1,769,698 bytes with no omissions; the Instagram reel at a diagnostic 1 MiB cap compressed to 905,859 bytes, with audio and a complete rendered card. The 654-second TikTok example returned `partial` / `compression_timeout`, with no attachment. **Long-video mainframe compression performance remains a follow-up**; the bot must preserve originals on incomplete delivery. No deadline/resource restriction was silently removed.

The first restart correctly refused one leftover labelled worker IPC volume from the TikTok check. Its owner label and lack of any attached containers were verified; only that exact unused temporary volume was removed. The broker recovered. No database or user media was stored in that IPC volume, no persistent application data was deleted, and no global Docker prune was run. Successful subsequent X/Instagram checks left no owned worker containers/volumes behind. Investigate cleanup timing under host load before claiming crash/orphan recovery is automatic.

Before any future cutover, verify the local and server process/container identities and allow only one bot using this token. To roll back, stop the new bot first and preserve post-cutover writes. Restore neither a ZFS snapshot nor an old dump over the live database without a fresh backup and explicit rollback decision. The old binary/configuration is not automatically safe with the new schema. A media-only Compose update is the safe first response if the bot itself must stay offline during repairs.

The initial deployment additions were not part of `bcde78a`. They are included with the subsequent owner-approved automatic-deployment release, separately from parked Reddit edits.

## Historical read-only assessment (before approval)

Read-only review on 2026-09-18, after publishing signed commit `bcde78a7f664900ddaec4d1c6ad8259cb2d7fa3c` to both `codex/social-media-replacement` and `caitlyn-3.0`. This is a checklist, not an implemented or approved deployment. Parked Reddit work is excluded. `main` is unchanged.

## Confirmed state

- SSH over the owner's Tailscale connection works using the existing homeserver identity and trusted host key. No SSH configuration or host-key trust was changed.
- Mainframe is an x86-64 TrueNAS host with Docker 28.3.1. Existing passwordless sudo permits Docker administration; no host Node/npm installation was found on PATH or added.
- TrueNAS reports the custom `caitlyn` app and the catalog `caitlyn-discord-bot-db` app as **STOPPED**. The configured database port has no listener. The original database contents/schema have **not** been inspected or changed; a stopped app is not evidence of lost data.
- The old bot definition uses `ghcr.io/razeviana/caitlyn:latest`, a persistent data mount and a server-side `.env`. Its companion Watchtower is configured to update labelled containers, and Caitlyn has that label. Do not start this legacy setup casually during preparation.
- The server `.env` explicitly sets `LLM_ENABLED=true`, and lacks the new social-worker/X account settings. Its reported mode is `0775` under UID/GID 568; review dataset ACLs and narrow secret-file access before deployment. No secret values were displayed or copied.
- The repository workflow builds and publishes the **bot image only**, on pushes to `main`. Publishing `caitlyn-3.0` did not run that workflow. The production image does not contain the broker scripts, media worker or FxEmbed service.
- FxEmbed's current base pin targets the Mac's ARM64 environment. The media source-update helper requires cached dependencies and a previously built baseline image; it cannot bootstrap a clean mainframe as-is. Mainframe-compatible images still need verified builds.
- The local bot/broker were left untouched. Confirm their process identities and current activity before any later cutover. The new logging code is published but has not been activated by a restart in this review.

## Proposed deployment shape

Use a reviewed TrueNAS custom-app Compose definition, supported by [TrueNAS's custom-app documentation](https://apps.truenas.com/managing-apps/installing-custom-apps/), with pinned release images rather than automatic `latest` updates during the rollout.

Keep separate responsibilities:

1. **Bot:** compiled application, Discord/database configuration, no Docker control socket or X account cookies.
2. **Media broker:** trusted Node service with Docker CLI access, shared owner-only Unix socket to the bot and a separate FxEmbed API key. Docker control is a powerful host privilege; only this trusted service may receive it.
3. **FxEmbed:** bounded local metadata API, isolated X session configuration and no bot/database credentials.
4. **Disposable media containers:** existing restricted gateway and network-disabled verification/compression workers. Keep current resource limits, secret isolation and cleanup checks.
5. **PostgreSQL:** retain a separate persistent database and backup lifecycle; never replace its data directory merely to update application code.

The broker currently accepts FxEmbed only at `http://127.0.0.1:<port>`. A plain Compose service hostname will not work. Review a shared network namespace or another explicitly tested local-only arrangement; do not weaken the origin check or expose the API publicly. Shared socket ownership must match the chosen bot/broker identities.

## Work required before activation

- Build and test AMD64 bot, broker, FxEmbed and media images from the published source only. Add a reviewed first-build path for media dependencies; retain pinned extractor dependencies and list every installed component/version/location. Do not build the dirty development checkout and accidentally include parked Reddit work.
- Prepare startup order, health checks, bounded restarts, shutdown and persistent storage. A crashed broker currently refuses leftover owned worker resources; define safe operator-reviewed recovery rather than blindly deleting containers/volumes.
- Implement unattended FxEmbed credential loading from a protected server-side file. The local launcher reads the Mac `.env` and injects temporary runtime secrets; a plain container restart does not restore them. Keep account cookies out of images, logs, command arguments and Docker environment configuration. X sessions can expire and still need owner renewal.
- Replace the old server feature settings deliberately: AI off, correct database and birthday timezone, private logging enabled through its saved configuration, and social processing enabled only once the broker is healthy. Do not copy the entire Mac `.env`, which contains local connection details.
- Pin release image digests and review/remove Caitlyn's Watchtower opt-in for controlled upgrades. Publishing `latest` while the old watcher is active can otherwise bypass the release checks. Do not merge into `main` just to obtain an image without an explicit release decision.
- Check available memory and resource limits with the existing workloads. One snapshot showed approximately 3.1 GiB available out of 64 GiB; this is not a load test or proof of a capacity problem.

## Database decision and migration safety

The owner must choose which data to take forward: the original mainframe database, or the local database that now includes live testing activity and current feature settings. Back up both before any replacement. Do not silently overwrite the original, merge counters, or treat local bot activity as synthetic test data.

If retaining the mainframe database, start **only its database app** after approval, inspect its schema read-only, take a verified backup, and apply only confirmed missing migrations in order. The migration runner has no applied-history table. **Never replay all historical migrations:** migration `002` replaces embedding data. Review `009` through `016` against actual schema and constraints; `015` preserves ambiguous voice history without guessing durations. No production migration list has yet been confirmed against the stopped database.

If moving the local database, perform a checked backup/restore to a separate target first and verify schema, records and ownership. Keep the old mainframe database recoverable. Establish a final write cutover so activity arriving after an initial copy is not lost. Do not replay pending/sent social or birthday work indiscriminately.

Private logging destination/levels and social channel opt-ins live in PostgreSQL, not just `.env`. Choose whether to transfer those reviewed settings or configure them again; never copy them implicitly with unrelated records. Review today's birthday-send history because the old bot did not have the new duplicate-prevention records. See [birthday recovery](birthday-recovery.md) and [database rollout](resilience.md#database-rollout).

## Controlled cutover and rollback

1. Obtain approval for the chosen database, server configuration and production activation. Take verified backups and preserve the old app definition/image references without recording secrets in Git.
2. Verify database connectivity/schema and media/backend health without logging a second bot into Discord. Test reboot/restart behavior and authorized media extraction separately.
3. Gracefully stop and confirm exit of the local bot before starting the mainframe bot with the same token. Finish any chosen data transfer while writes are stopped. Never run both instances together.
4. Check startup readiness, database access, AI-off state, private log routing, `/social` settings and owner-sent X/TikTok/Instagram examples. The logging release adds no commands; verify the existing guild registration and publish only if it differs. Keep owner-only logging commands out of global registration.
5. Observe birthday/voice/activity handling and logs. On failure, stop the mainframe bot first. Select the correct database/image for rollback before starting one replacement instance; do not discard post-cutover writes or assume an old binary is compatible with every new schema change.

No installations, server configuration changes, service starts/stops, migrations, command registrations or live Discord test messages were performed in this assessment.
