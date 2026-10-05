# Mainframe installation inventory

## Current production release: 2.2.0

The independent chat archive went online on **2026-10-05 at 12:59 CEST (Europe/Amsterdam)** from revision `6eec33355de4f1df0f8279efc40c3af3c549278f`, merged through [PR #2](https://github.com/RazeViana/Caitlyn/pull/2). The [complete release](https://github.com/RazeViana/Caitlyn/releases/tag/main-6eec33355de4f1df0f8279efc40c3af3c549278f) contains the immutable four-image manifest and exact package inventory. This extends the initial 2.2.0 voice release, activated at 11:53 CEST through [PR #1](https://github.com/RazeViana/Caitlyn/pull/1). No TrueNAS host packages, GPU drivers or database image were changed.

| Component | Running or configured image ID | Inventory |
| --- | --- | --- |
| Bot | `sha256:2038ca450dda43ea924f7929d910f066adb2e8762912a133cc5ef4e4f0f35dbf` | 18 OS packages; 192 npm entries |
| Broker | `sha256:0d6abe1998243f2abadcda0c3ccb5aace1b02ecc0402ca068bb6d4ae38a83e21` | 20 OS packages; 192 npm entries |
| FxEmbed | `sha256:7d345413a7860e45ed3e194c53f456c50cea4efc9a8ffdaf08077aace130ae00` | 88 OS packages; 583 npm entries |
| On-demand media worker | `sha256:176e5e6e99c76a5eca9bd6e962752ca1de672e775b0883d5c2a70f6c918a738f` | 136 OS packages; 145 npm entries |
| Local speech worker | `sha256:d084ad44d35059e52ae0d9ad2de28a2db9dba242c277ebd6976c2aefc59f58ec` | 87 OS packages; 28 Python packages; [worker inventory](caitlyn-test-installations.json) |

The separate TrueNAS app `caitlyn-transcription` runs the tested worker from source `365118e7c9aca5aaa184ba4359eca95d9b5a6864`, using the GTX 1070, pinned English `base.en`, `cuda` and `int8_float32`. It has Docker init enabled, a direct health probe, no published port and the internal `caitlyn-transcription` network. The production bot joins that network alongside its original network. The existing PostgreSQL 17.8/pgvector 0.8.1 app remains separate and unchanged.

Production transcripts are under `/mnt/Datashare/apps/caitlyn-transcripts`, mounted at `/var/lib/caitlyn/transcripts`, with UID/GID 1000, directories 0700 and files 0600. Voice recording is enabled for all ordinary voice channels, one channel at a time, with indefinite retention. New delivered chat messages, edits and deletions are captured independently of voice attendance or pauses. Text visibility follows current Discord channel permissions; voice visibility retains per-event attendance. The separate test bot remains online with voice paused and chat capture enabled. Production environment settings remain in `/mnt/Datashare/apps/caitlyn-discordbot/runtime-v3-20260918-1/bot/bot.env`; no secret values are stored here.

Migrations 017/018 were applied during the initial voice release, preserving all ten original tables. Migration **019** was rehearsed against a fresh restored backup and applied transactionally to production, preserving all 169 existing events and every voice record exactly. Its only existing-row changes group old messages by their source text channel. Both transcript events and private permission snapshots have row security enabled. Snapshots refresh every 30 seconds and expire after 90 seconds. The migration fingerprint approved by the normal updater is `52935b37c2e69927804d8355bb332b2ce341e6fabe3536a388ecc542c5836f94`; automatic updates are enabled.

TrueNAS jobs **234106 / 234108 / 234110** stopped, updated and started the main app. The installed updater checked all four image identities, the database preflight, service health and Discord startup, then registered 15 guild commands including eight administrator-only `/transcribe` actions. The existing private operational log channel includes INFO, SUCCESS, WARN and ERROR. Startup had no warning/error markers. At the 13:00 CEST check, all five persistent services were healthy, the archive contained 182 events including 158 speech records, and three new chat messages had arrived since startup. A restricted read for a member who had never joined voice returned four chat records, zero voice records and zero private permission rows. The capture queues were empty, permission refresh was healthy and no segments were lost or quarantined. No website settings or credentials were changed.

The exact feature source passed type checking, lint, build and **480 tests without skips**, including both PostgreSQL suites. The separate test bot also proved chat capture while voice was paused, access to messages posted during a member's absence, and denial of voice records to a nonparticipant. GitHub's main-branch release checks passed before deployment.

Daily verified backups use `/root/.config/caitlyn-transcript-backup/production.json` and TrueNAS cron **4**, description **Back up production Caitlyn transcripts and verify PostgreSQL restore**. The schedule is 04:35 in the host's `America/Los_Angeles` timezone, currently 13:35 Europe/Amsterdam; DST transition weeks can change that conversion. Pre-update job **234086** restored 169 events. Post-release job **234117** restored **184 events** with row security and checkpoints intact; test job **234118** restored 84 events. Backups are stored under `/mnt/Datashare/apps/caitlyn-discordbot/backups/transcripts`, with no automatic deletion.

The production backup folders initially inherited named NFSv4 grants from their parent dataset. Earlier jobs **233883 / 233884** removed those grants only from the new release-backup and transcript-backup directories. Existing copies were made root-private, and new-file probes verified 0700 directories and 0600 files. Check `filesystem.getacl` as well as Unix mode bits when recreating these directories: `chmod` alone does not remove named NFSv4 grants. The live transcript directory and both new production backups have trivial private ACLs.

The current rollback bundle is `/mnt/Datashare/apps/caitlyn-discordbot/backups/transcripts/scheduled-20261005T105230Z-7c59c8`. It contains the previous app configuration/images, private environment copies, updater configuration/state, consistent database dump, original logs, migration verification, release manifest/package inventory and final deployment evidence. For rollback, pause the updater, stop only `caitlyn`, apply `previous-production-compose.json` through TrueNAS, restart and register the previous guild commands. This update did not change the bot environment or worker app. Keep all transcript files and additive database tables; never restore an older dump over newer activity. The old bot does not refresh text permissions, so text reads fail closed when the snapshots expire. Keep automatic updates paused until the rollback revision/state is reconciled. The successful post-release backup is `scheduled-20261005T110047Z-c82dda` in the same backup root. Private coordinator evidence is in `/root/.config/caitlyn-chat-access-release`.

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
