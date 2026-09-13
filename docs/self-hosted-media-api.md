# Caitlyn-owned media API

## Scope and ownership

Caitlyn now uses the actual pinned [FxEmbed backend](fxembed.md) in `vendor/fxembed`, with `SOCIAL_X_PROVIDER=fxembed` as its only mode. The local backend serves X API v2 metadata on loopback; this broker exposes validated metadata and verified media to the bot over an owner-only Unix socket. All VX runtime paths, profiles and session-file support have been removed.

An owner-provided X session from the local `.env` is now configured in FxEmbed; the broker uses a separate private API key and never receives the X cookies. The formerly age-denied test post now passes metadata and verified video delivery checks, as recorded in [the handoff](handoff.md). X restrictions and session expiry still apply. No hosted Fx/VX API fallback is used. [TikTok videos](tiktok.md) use a separate public extractor inside the isolated worker without FxEmbed or host/account credentials. Instagram/Reddit and homeserver deployment remain separate work.

## Are media files downloaded and uploaded?

Yes, for normal bot previews. The worker downloads original images or a fitting MP4 from X's CDN into temporary container storage, validates MIME/size/dimensions/codecs/audio and decoding, and returns bounded bytes with SHA-256 hashes over the private socket. The bot validates the transport and uploads those buffers as Discord attachments with its own embeds and sender attribution.

The worker container and its temporary download files are removed when extraction finishes, before the bot uploads its in-memory copies. No persistent media cache or host media directory is created. Node buffers are released through normal garbage collection after use, not guaranteed secure memory erasure. Discord hosts the delivered attachments; deleting local temporary files does not delete Discord's copies. Local testing uses the Mac's download and upload bandwidth. A later homeserver deployment would move that traffic there.

Metadata-only requests are different: they return text, attribution, media identities and validated CDN URLs but **do not download or upload media**. Their `purpose=metadata` results cannot be mistaken for successful delivery or authorize deleting a source message. Normal delivery still removes an unchanged source only after all required replacements are confirmed complete; failures, partial media, edits, extra uploads/reply context and uncertain sends preserve it as documented in [social delivery](social-delivery.md).

## Private API contract

The host broker runs `scripts/socialWorker/server.ts` and launches disposable network-restricted workers from the locally built image. The API uses an owner-only Unix socket, not a TCP/public listening port. Its parent directory must belong to the operator and have mode 0700; the socket is 0600. Running bot and broker under the same Mac account is a convenience for testing, not a host privilege boundary. A production service/user/container arrangement still requires review.

| Endpoint | Request | Result and side effects |
| --- | --- | --- |
| `GET /v1/health` | No body | Local service version, idle/busy state, provider mode, hosted-metadata flag. No Docker, X, DB, or Discord probe. |
| `POST /v1/x/metadata` | Version, canonical X URL, optional `allowSensitive` boolean | Bounded normalized metadata only; local FxEmbed retrieval; no media download or Discord action. |
| `POST /v1/x` | Existing delivery request with explicit file/total byte budgets | Normalized post plus verified attachment bytes; actual Discord sending remains the bot's responsibility. |
| `POST /v1/tiktok` | Version, canonical TikTok video/share URL, file/total byte budgets | Isolated public extraction and verified MP4 bytes; `provider=tiktok`. No TikTok metadata-only route or account access. |

Metadata request example:

```json
{"version":1,"url":"https://x.com/alice/status/123"}
```

The example ID is illustrative, not a live test. Only `version`, `url`, and optional `allowSensitive` are accepted on the metadata route. Provider overrides, delivery flags, custom URLs/headers/cookies and upload budgets are rejected there. Request bodies are limited to 2 KiB, metadata responses to 1 MiB, and processing to a 55-second broker deadline (the client defaults to 60 seconds). Normal delivery retains its separate 30 MiB wire cap, 8 MiB/file and 20 MiB aggregate budgets. One active extraction is allowed per broker; health remains readable while busy, but another extraction is refused.

Successful metadata responses carry `version=1`, `purpose=metadata`, `provider=fxembed`, `outcome=ready|partial`, and `post`. The post includes bounded text/author, ordered media, validated X CDN URLs/variants, and at most one independently attributed quote. Readiness describes metadata completeness only, not successful downloading or posting. Closed failure outcomes and sanitized diagnostics are preserved; raw provider errors, unknown fields and credentials are not returned. Both server and client validate the metadata response. Responses use `Cache-Control: no-store`.

Use `requestSocialMetadata` in `core/socialWorkerClient.ts` for internal calls. Use the following content-free CLI check for an approved public post; it prints counts/types/outcomes, not text or media URLs:

```bash
node --import tsx scripts/testSocialMetadataLocal.ts /path/to/private/worker.sock https://x.com/author/status/123
```

## Reproducible offline source build

This Mac already has the dependency baseline. The build command stages only explicitly listed worker sources, never `.env`, the bot checkout as a whole, credentials, or user media. It requires the pinned base image and baseline image to exist locally, builds with `--network=none --pull=false`, checks that all dependency layers match the baseline, and only then updates the target tag. A failed verification does not replace the working tag. Changing dependency layers requires a separately reviewed update and installation inventory; this script does not fetch missing packages/base images.

```bash
node --import tsx scripts/buildSocialWorkerImage.ts colima-caitlyn-media-test caitlyn-media-probe:local
```

The target defaults to `caitlyn-media-api:local`. Subsequent builds may use the current API image as the dependency baseline, or an inspected immutable `sha256:` ID. This is an offline source-update builder, **not a fresh-machine bootstrap**. A clean machine needs a reviewed dependency installation first. All images/dependencies from previous steps remain available; nothing was pruned.

First [build and start the FxEmbed container](fxembed.md#build-and-start). Start the private API after creating a suitable private socket directory. Export broker settings in its terminal; normal `.env` loading preserves these explicit overrides and excludes all `FXEMBED_X_*` account values. When FxEmbed has an account configured, also set `SOCIAL_FXEMBED_KEY_FILE` to the owner-only API key created by the launcher:

```bash
SOCIAL_WORKER_DOCKER_CONTEXT=colima-caitlyn-media-test \
SOCIAL_WORKER_IMAGE=caitlyn-media-api:local \
SOCIAL_X_PROVIDER=fxembed \
SOCIAL_FXEMBED_KEY_FILE=/path/to/private/fxembed.key \
SOCIAL_WORKER_SOCKET=/path/to/private/worker.sock \
LOG_LEVEL=INFO node --import tsx scripts/socialWorker/server.ts
```

Start the bot separately with the same socket, local DB overrides, `SOCIAL_MEDIA_ENABLED=true`, and `LLM_ENABLED=false` as described in [manual testing](social-delivery.md#authorized-manual-discord-test). Do not run two bot processes with the same token. TikTok adds no command name, but updates `/social` descriptions; register that existing command in the authorized test guild when activating this version. Keep existing channel opt-ins and private logging configuration. See [handoff](handoff.md) for the currently selected image.

## Dependencies

| Component | Why retained |
| --- | --- |
| Node.js and the bot's existing packages | Private HTTP/Unix API, Discord and PostgreSQL integration; no new web framework. |
| Python standard library | Bounded CDN downloads only; no metadata retrieval or new Python packages. |
| Pinned yt-dlp 2026.8.19 | Retained for the older multi-platform probe harness; no longer used for X metadata delivery. |
| FFmpeg/ffprobe 8.1.2 | Local image/video validation and decoding. No hosted conversion service. |
| Docker/Colima/Lima | Existing isolation and local Linux execution. Workers have no bot credentials or Docker socket. |
| X/CDN and Discord | Source data and final attachment hosting; self-hosting cannot remove these platform dependencies. |

FxEmbed adds locked npm dependencies inside a separate Debian/Node container. Exact package versions, paths, base OS packages and source provenance are in [the FxEmbed inventory](fxembed-installations.md); prior media-worker installations remain recorded in [the existing inventory](media-test-installations.md). No macOS or root-project packages were added. No cloud deployment or autostart service was created.

## Verification and current state

Current test results, approved public-post smoke checks, running process IDs and image hashes are recorded in [the latest handoff](handoff.md). Tests must use the updated FxEmbed verifier image; an old image still contains the removed extraction path. `GET /v1/health` is only broker liveness, not proof that FxEmbed, X, Docker or Discord are healthy.

Nothing was committed, merged, pushed or deployed to the homeserver during this replacement. New manual Discord messages are required to verify desktop/mobile playback and original-message cleanup; old jobs are not replayed.
