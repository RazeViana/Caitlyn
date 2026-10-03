# Voice transcription development inventory

Verified on Mainframe on 2026-10-01 (Europe/Amsterdam). Work is in `/mnt/Datashare/home/raze/Development/caitlyn-dev` on `2.2.0` (originally `feat/voice-transcription-daily-logs`), based on the shared `main`/`caitlyn-3.0` commit `8608331`. The package version is now `2.2.0`; the image inventories below describe the earlier development builds. No host packages were installed, and the running TrueNAS Caitlyn app was not changed. Temporary tests used no Discord token or production database.

The complete [machine-readable inventory](voice-transcription-installations.json) lists every installed workspace npm dependency and every package/version/path inspected in the development images, including inherited OS/toolchain packages. The lockfile records the npm dependency resolution; the speech worker's [requirements](../scripts/transcription/requirements.txt) and [CUDA requirements](../scripts/transcription/requirements-cuda.txt) pin all Python dependencies.

| Component | Version/location |
| --- | --- |
| Development Node/npm | Reused `caitlyn-validation:20260924`; Node 24.21.0, npm 11.19.0, inside the container |
| Workspace npm dependencies | `<checkout>/node_modules`; installed with the existing container as UID/GID 3000, including development dependencies |
| Discord voice library | `@discordjs/voice` 0.19.2, `<checkout>/node_modules/@discordjs/voice` and `/app/node_modules/@discordjs/voice` in the bot image |
| Opus decoding | `opusscript` 0.1.1 at the corresponding `node_modules/opusscript` paths |
| DAVE encryption | `@snazzah/davey` 0.1.12, resolved in the npm lockfile and verified inside the compiled bot image |
| Compiled bot image | `caitlyn-voice:dev`, `sha256:e99f4c37660793037219036ac82b7e02599ac9094fbf8f9121bbe72cae4b904c` |
| Original CPU speech image | `caitlyn-transcription:dev-base-en`, `sha256:da8614f3f3a7c7b1d73c761f400776e04e19c5a5cb0f6ff457bc58c1d9b2c87e` |
| Configurable CPU speech image | `caitlyn-transcription:dev-base-en-cpu`, `sha256:5a40e294c0db662b7093ececb413dd0f8656c8decf7d315fda888613a923f637` |
| GPU speech image | `caitlyn-transcription:dev-base-en-cuda`, `sha256:47a23bc60c23f2506ebe573bd955f5128f4e436e9aaf488db61c71f0d6ae329f` |
| GPU libraries | `nvidia-cublas-cu12` 12.8.4.1 and `nvidia-cudnn-cu12` 9.10.2.21, under `/usr/local/lib/python3.11/site-packages/nvidia/` inside the GPU image |
| Recognition engine | faster-whisper 1.2.1 and CTranslate2 4.8.2, `/usr/local/lib/python3.11/site-packages` inside the speech image |
| English model | `Systran/faster-whisper-base.en`, revision `3d3d5dee26484f91867d81cb899cfcf72b96be6c`, `/models/whisper` inside the speech image |
| Worker source | `/app/server.py` inside the speech image; runs as UID/GID 65534 |

Builds downloaded package archives and model weights. Runtime inference was tested with `--network none`, a read-only root filesystem, a two-CPU limit and a 1 GiB memory limit. The upstream faster-whisper [JFK speech fixture](https://github.com/SYSTRAN/faster-whisper/blob/master/tests/data/jfk.flac) was converted in memory and sent through the actual worker HTTP handler. It correctly transcribed the 11-second sample. The first run during a concurrent build took 20.47 seconds; subsequent model runs took 1.93 and 1.91 seconds. These sample timings do not establish capacity for a whole busy voice channel.

The follow-up GPU comparison used the same model, fixture, HTTP handler, beam size, VAD and resource limits on a GTX 1070 (8 GiB) with the existing 570.172.08 host driver. Docker already had NVIDIA support; no driver or host toolkit was installed or changed. The GPU was idle with 158 MiB allocated before testing and returned to that state afterward. The benchmark results were:

| Backend | First request | Next three requests | Warm median |
| --- | --- | --- | --- |
| CPU / int8 | 2.048 s | 1.909, 1.954, 1.883 s | 1.909 s |
| GPU / int8_float32 | 16.942 s | 0.244, 0.284, 0.313 s | 0.284 s |

Both backends returned the same transcript SHA-256, `e4e644650803b9dca2d1caaf17fbfa3b5cd835a792b8d53d888c6996f7eb1c5d`. GPU steady-state latency was about 6.7 times lower on this sample; its first request includes CUDA library initialization. Both tests ran with networking disabled and exposed no host ports. The GPU image is approximately 2.64 GB, including the CUDA libraries; the configurable CPU image is approximately 717 MB. The benchmark is reproducible with [benchmark.py](../scripts/transcription/benchmark.py).

The compiled bot image loaded its runtime, initialized the real Opus decoder, and reported working native AES-256-GCM and DAVE support as its unprivileged user with networking disabled. After the GPU changes, the full quality gate passed **421 tests with one optional PostgreSQL skip**, including typecheck, lint and build. The worker HTTP wrapper ran six Python cases covering input validation, health, inference routing, CPU/GPU settings and rejection of unsupported precision. Both CPU and GPU Compose configurations validated. Real encrypted Discord reception and multi-speaker accuracy still require a live activation test.

The images are local development artifacts, not published releases. Follow [activation and rollback](voice-transcription.md#mainframe-activation-and-rollback) before replacing the live bot. Raw audio/transcripts from real conversations were neither accessed nor generated during development.

The owner's selected deployment mode is GPU. `scripts/transcription/compose.yaml` and the Dockerfile's default final stage select CUDA; `compose.cpu.yaml` is a standalone CPU alternative. Selecting this default changes the feature branch configuration, not the running TrueNAS app.
