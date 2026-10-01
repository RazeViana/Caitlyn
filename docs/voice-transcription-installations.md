# Voice transcription development inventory

Verified on Mainframe on 2026-10-01 (Europe/Amsterdam). Work is in `/mnt/Datashare/home/raze/Development/caitlyn-dev` on `feat/voice-transcription-daily-logs`, based on the shared `main`/`caitlyn-3.0` commit `8608331`. No host packages were installed, and the running TrueNAS Caitlyn app was not changed. Temporary tests used no Discord token or production database.

The complete [machine-readable inventory](voice-transcription-installations.json) lists every installed workspace npm dependency and every package/version/path inspected in both development images, including inherited OS/toolchain packages. The lockfile records the npm dependency resolution; the speech worker's [requirements](../scripts/transcription/requirements.txt) pin all Python dependencies.

| Component | Version/location |
| --- | --- |
| Development Node/npm | Reused `caitlyn-validation:20260924`; Node 24.21.0, npm 11.19.0, inside the container |
| Workspace npm dependencies | `<checkout>/node_modules`; installed with the existing container as UID/GID 3000, including development dependencies |
| Discord voice library | `@discordjs/voice` 0.19.2, `<checkout>/node_modules/@discordjs/voice` and `/app/node_modules/@discordjs/voice` in the bot image |
| Opus decoding | `opusscript` 0.1.1 at the corresponding `node_modules/opusscript` paths |
| DAVE encryption | `@snazzah/davey` 0.1.12, resolved in the npm lockfile and verified inside the compiled bot image |
| Compiled bot image | `caitlyn-voice:dev`, `sha256:e99f4c37660793037219036ac82b7e02599ac9094fbf8f9121bbe72cae4b904c` |
| Speech image | `caitlyn-transcription:dev-base-en`, `sha256:da8614f3f3a7c7b1d73c761f400776e04e19c5a5cb0f6ff457bc58c1d9b2c87e` |
| Recognition engine | faster-whisper 1.2.1 and CTranslate2 4.8.2, `/usr/local/lib/python3.11/site-packages` inside the speech image |
| English model | `Systran/faster-whisper-base.en`, revision `3d3d5dee26484f91867d81cb899cfcf72b96be6c`, `/models/whisper` inside the speech image |
| Worker source | `/app/server.py` inside the speech image; runs as UID/GID 65534 |

Builds downloaded package archives and model weights. Runtime inference was tested with `--network none`, a read-only root filesystem, a two-CPU limit and a 1 GiB memory limit. The upstream faster-whisper [JFK speech fixture](https://github.com/SYSTRAN/faster-whisper/blob/master/tests/data/jfk.flac) was converted in memory and sent through the actual worker HTTP handler. It correctly transcribed the 11-second sample. The first run during a concurrent build took 20.47 seconds; subsequent model runs took 1.93 and 1.91 seconds. These sample timings do not establish capacity for a whole busy voice channel.

The compiled bot image loaded its runtime, initialized the real Opus decoder, and reported working native AES-256-GCM and DAVE support as its unprivileged user with networking disabled. The full quality gate passed 420 tests with one optional PostgreSQL skip; a subsequently added lifecycle test also passed. The worker HTTP wrapper additionally ran three Python cases covering input validation, health and inference routing. Real encrypted Discord reception and multi-speaker accuracy still require a live activation test.

The images are local development artifacts, not published releases. Follow [activation and rollback](voice-transcription.md#mainframe-activation-and-rollback) before replacing the live bot. Raw audio/transcripts from real conversations were neither accessed nor generated during development.
