# Mainframe installation inventory

## Current production release: 2.2.0

Caitlyn 2.2.0 went online on **2026-10-05 at 11:53 CEST (Europe/Amsterdam)** from revision `0e0a208b6f8d057a52ebb82fb23418088158f4b8`, merged through [PR #1](https://github.com/RazeViana/Caitlyn/pull/1). The [complete release](https://github.com/RazeViana/Caitlyn/releases/tag/main-0e0a208b6f8d057a52ebb82fb23418088158f4b8) contains the immutable four-image manifest and exact package inventory. No TrueNAS host packages, GPU drivers or database image were changed.

| Component | Running or configured image ID | Inventory |
| --- | --- | --- |
| Bot | `sha256:51620d10ba706b6a03218d28a934ed3c851b7f4ee4197a4bb27d941da23c662d` | 18 OS packages; 192 npm entries |
| Broker | `sha256:2c654fb54d4a3e4a38fc41ae9c52819e33a966f022e840fde0349141ae7a1cce` | 20 OS packages; 192 npm entries |
| FxEmbed | `sha256:2c5c21e72874239e4623dd3fc702efe203176e4078df66405d4529e481e2c566` | 88 OS packages; 583 npm entries |
| On-demand media worker | `sha256:97aacd84a899097d756a57f6eb8896669f798ee3e9b14152697ae8c33873b267` | 136 OS packages; 145 npm entries |
| Local speech worker | `sha256:d084ad44d35059e52ae0d9ad2de28a2db9dba242c277ebd6976c2aefc59f58ec` | 87 OS packages; 28 Python packages; [worker inventory](caitlyn-test-installations.json) |

The separate TrueNAS app `caitlyn-transcription` runs the tested worker from source `365118e7c9aca5aaa184ba4359eca95d9b5a6864`, using the GTX 1070, pinned English `base.en`, `cuda` and `int8_float32`. It has Docker init enabled, a direct health probe, no published port and the internal `caitlyn-transcription` network. The production bot joins that network alongside its original network. The existing PostgreSQL 17.8/pgvector 0.8.1 app remains separate and unchanged.

Production transcripts are under `/mnt/Datashare/apps/caitlyn-transcripts`, mounted at `/var/lib/caitlyn/transcripts`, with UID/GID 1000, directories 0700 and files 0600. Recording is enabled for all ordinary voice channels, one channel at a time, with indefinite retention. The separate test bot remains online with recording paused. Production environment settings remain in `/mnt/Datashare/apps/caitlyn-discordbot/runtime-v3-20260918-1/bot/bot.env`; no secret values are stored here.

Migrations 017/018 were applied to the existing production database in a transaction. Fingerprints of all ten original tables were identical before and after the migration. Transcript row security is enabled. The migration fingerprint approved by the normal updater is `00c946dffb53e3bb46c380f9671116c4ffc6dc1b803ceb2660b635f77a2570fe`; automatic updates are enabled again.

TrueNAS jobs **233873 / 233874 / 233876** stopped, updated and started the main app. The release verified all four image identities, database preflight, healthy services and Discord startup, then registered 15 guild commands including eight administrator-only `/transcribe` actions. The recording notice and recorder messages were observed in Discord. The existing private operational log channel now includes INFO, SUCCESS, WARN and ERROR. Startup had no warnings or errors. The first production archive contained two attendance records and a session start, with no lost segments, pending work or quarantine entries; no production speech had arrived at that check. Speech recognition and usernames passed the earlier two-person test.

Daily verified backups use `/root/.config/caitlyn-transcript-backup/production.json` and TrueNAS cron **4**, description **Back up production Caitlyn transcripts and verify PostgreSQL restore**. The schedule is 04:35 in the host's `America/Los_Angeles` timezone, currently 13:35 Europe/Amsterdam; DST transition weeks can change that conversion. Job **233850** verified the initial migrated database. After release, job **233892** restored all three initial production events with row security intact. Backups are stored under `/mnt/Datashare/apps/caitlyn-discordbot/backups/transcripts`, with no automatic deletion.

The production backup folders initially inherited named NFSv4 grants from their parent dataset. Jobs **233883 / 233884** removed those inherited grants only from the new release-backup and transcript-backup directories. Existing copies were made root-private, and new-file probes verified 0700 directories and 0600 files. Check `filesystem.getacl` as well as Unix mode bits when recreating these directories: `chmod` alone does not remove named NFSv4 grants. The live transcript directory has a trivial private ACL.

The release rollback bundle is `/mnt/Datashare/apps/caitlyn-discordbot/backups/transcription-release-20261005T090918Z-9e25ae`. It contains the previous app configuration/images, environment, guild commands/log filters, updater configuration, consistent database dumps, migration verification and final deployment evidence. For rollback, pause the updater, stop only `caitlyn`, restore the saved `bot.env` with UID/GID 1000 and mode 0600, and apply `previous-compose.json` through TrueNAS before restarting and restoring guild commands. Restore the saved operational log levels if desired. Keep all transcript files and additive database tables; never restore an older dump over newer activity. Keep automatic updates paused until the rollback revision/state is reconciled so the released image is not immediately reapplied. The test instance and database need no rollback.

## Original installation inventory: September 18

Deployment date: 2026-09-18. **No packages were installed on macOS or the TrueNAS host.** New packages and downloaded base images were confined to Docker on the mainframe. The existing PostgreSQL 17.8 container/data directory was reused, not upgraded.

[Complete installed package list](mainframe-installations.json) enumerates every observed OS package and npm package with exact versions; npm entries include their installed paths. It also records both Python virtual-environment packages and the exact image IDs. Counts below include dependencies bundled with each base image, not only packages added by the Dockerfile. Packages repeated across images are intentionally listed in each image.

| Image | Main components | Complete inventory entries |
| --- | --- | --- |
| Bot | Node 24.21.0, npm 11.19.0, Yarn 1.22.22; production dependencies from the existing application lockfile | 18 Alpine packages; 187 npm entries (42 application, 145 global) |
| Broker | Bot dependencies plus Docker CLI 29.5.3 and CA certificates 20260909-r0 | 20 Alpine packages; 187 npm entries |
| Media worker | Node 24.21.0, npm 11.19.0, Yarn 1.22.22, Python 3.14.7, FFmpeg 8.1.2, yt-dlp 2026.8.19, virtual-environment pip 26.2.1 | 136 Alpine packages; 145 global npm entries; 2 virtual-environment Python packages |
| FxEmbed | Node 24.19.0, npm 11.17.0, Yarn 1.22.22; vendored FxEmbed dependencies from its existing lockfile | 88 Debian packages; 583 npm entries (438 application/workspace, 145 global) |
| Build stage only | Node 24.21.0, npm 11.19.0, Yarn 1.22.22; application build/test dependencies from the existing lockfile | 18 Alpine packages; 289 npm entries (144 application/build, 145 global) |

The media image's system `py3-pip` package is 26.1.2-r0; its separate extractor environment uses pip 26.2.1. Extractor packages live under `/opt/extractor/lib/python3.14/site-packages`. OS package entries record the distribution package revision as well as its version. The broker's Docker CLI does not replace the host's Docker Engine 28.3.1.

Base images downloaded to the mainframe:

- `node:24-alpine@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a`
- `node:24.19.0-bookworm-slim@sha256:e5a8dee7bc1e6a215d224a7ef8206f7e77271bc3cabd5febf2beafac0674f174`

Application source: published `bcde78a7f664900ddaec4d1c6ad8259cb2d7fa3c` plus reviewed deployment overlays. FxEmbed source: `5b5b6207d9fd93bae15a68ab659fbc97cdbf61b5`. No project/vendor lockfile was changed. The build-stage inventory was collected from the same cached lockfile installation used by the final release. Earlier failed image candidates contain subsets of these same packages; their tags/build caches were retained, not globally pruned.

Inventories were collected inside non-networked, read-only disposable containers using `scripts/deployment/imageInventory.mjs`. They contain no environment values, credentials, post content or database records.
