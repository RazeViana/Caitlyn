# Local FxEmbed backend

Caitlyn includes the actual [FxEmbed source](https://github.com/FxEmbed/FxEmbed/tree/5b5b6207d9fd93bae15a68ab659fbc97cdbf61b5), pinned at `5b5b6207d9fd93bae15a68ab659fbc97cdbf61b5`, under `vendor/fxembed`. It is MIT-licensed; the full notice is in [licenses/FxEmbed.txt](licenses/FxEmbed.txt). Vendor files retain upstream formatting. All Caitlyn-owned integration files follow the project's file-header convention.

The former VX-derived Python extractor, request profiles, session-file loader, VX API adapter/provider option, and unused message handler are removed. Only `SOCIAL_X_PROVIDER=fxembed` is accepted, and it is the default. Old `direct`/`vxtwitter` settings fail startup rather than silently retaining an old backend.

## Data flow and scope

1. The bot queues an opted-in X post using its existing durable delivery and private logging.
2. The owner-only Unix broker calls `GET /2/status/<id>` on the local FxEmbed container. It never calls hosted Fx/VX services.
3. Caitlyn validates API v2 metadata, post identity, attribution, ordered media, and at most one quote. Only expected X CDN image/MP4 URLs are accepted.
4. For delivery, the broker sends bounded JSON on stdin to a disposable network-none worker behind a restricted gateway. The worker downloads original images/budgeted MP4s, verifies bytes/MIME/dimensions/codecs/decoding, and returns bounded attachments.
5. Caitlyn mentions the sender, uploads the verified files to Discord, and removes the unchanged original only after complete, confirmed replacement. Failures, partials and ambiguous sends retain it.

Metadata-only requests stop after step 3. FxEmbed's web pages, other platform routes, redirects, search, profiles and public API hosting are deliberately not exposed by the local wrapper. This is the X slice of Caitlyn's replacement; TikTok/Reddit/Instagram adapters remain separate work. Polls, articles, rich cards, oversized media and nested quotes are still marked partial where Caitlyn cannot fully render them.

## Build and start

Existing Node 24/tsx and a local Docker engine are required. No Cloudflare account, deployment, login, account cookie, paid API or new slash command is needed for public-post testing. These commands install dependencies only inside the FxEmbed image, not into the bot project or macOS:

```bash
node --import tsx scripts/fxEmbed/manage.ts build colima-caitlyn-media-test
node --import tsx scripts/fxEmbed/manage.ts start colima-caitlyn-media-test
```

The current Dockerfile pins Linux arm64 for this Mac; an amd64 deployment requires reviewing/pinning its own Node base digest first. The helper requires a local Unix Docker endpoint, copies an allowlisted build context without `.env`/credentials, and refuses to replace an existing container named `caitlyn-fxembed`. Builds use the vendored npm lockfile with install lifecycle scripts disabled. See [every installed package/version/path](fxembed-installations.md).

The container publishes only `127.0.0.1:8787`, has no host directories, Docker socket or bot environment, and runs as UID 1000 with a read-only root, dropped capabilities and resource limits. Writable Wrangler state is temporary. The backend needs normal outbound networking to reach X; unlike the media verifier, it is **not** behind Caitlyn's CDN gateway. Anonymous startup contains no account credentials. Account startup additionally requires the private API key described below; loopback alone is not user authentication.

Start the media broker after building the updated verifier:

```bash
node --import tsx scripts/buildSocialWorkerImage.ts colima-caitlyn-media-test caitlyn-media-api:local
SOCIAL_WORKER_DOCKER_CONTEXT=colima-caitlyn-media-test \
SOCIAL_WORKER_IMAGE=caitlyn-media-api:local \
SOCIAL_X_PROVIDER=fxembed SOCIAL_FXEMBED_URL=http://127.0.0.1:8787 \
SOCIAL_WORKER_SOCKET=/path/to/private/worker.sock \
LOG_LEVEL=INFO node --import tsx scripts/socialWorker/server.ts
```

The socket directory must already be owned by the operator, mode 0700. The bot uses the same socket with `SOCIAL_MEDIA_ENABLED=true`, plus existing guild/channel opt-in. AI remains disabled by default. Keep the homeserver bot inactive while using the same token on the Mac.

Backend health: `GET http://127.0.0.1:8787/__caitlyn/health` checks local runtime/cache access only, not X access. Broker health is separately documented in [the private API guide](self-hosted-media-api.md). No autostart or cloud deployment is configured.

## Local compatibility and privacy

Caitlyn bundles upstream's worker and Atmosphere package with its actual Hono routes and X extractor. The source snapshot remains unchanged. The build-time compatibility transform changes exactly two X guest-request Cloudflare `cacheTtl` hints into `cacheControl: no-store`: local workerd rejected the former with a mutually-exclusive cache-options error before contacting X. The transform asserts its match count and requires review if upstream changes. The explicit upstream guest-token Cache API remains intact; no X request endpoint or authentication behavior is changed.

The slim image lacks a system CA bundle. The build exports Node's standard Mozilla root certificates to `/app/ca-certificates.pem` and configures workerd/OpenSSL to use it. TLS verification remains enabled. No custom certificate, trust-all switch, or host trust-store mount is used.

Sentry, telemetry, translations, mosaics and external transcoders are disabled in the local build. No account credentials are embedded in the image. Upstream content/token console logging is suppressed by the wrapper, Wrangler output/file logging is disabled, and Docker logging is disabled. Caitlyn's existing scoped logger reports validated provider/outcome diagnostics to the configured private Discord log channel; it never forwards raw backend output.

## Authorized X account from the local .env (preferred for local testing)

The local launcher can use the existing root `.env` directly, with **no 1Password CLI or interactive unlock**. Fill these three fields in that file, not in chat or shell command arguments:

```dotenv
FXEMBED_X_USERNAME=
FXEMBED_X_AUTH_TOKEN=
FXEMBED_X_CT0=
```

Use the X handle without `@` and the complete `auth_token` and `ct0` cookie values from the dedicated account that can already view the post. This deliberately stores the session as plaintext in the local file, just like the existing bot token. Protect it with `chmod 600 .env`; Git and the root Docker context already exclude `.env`. Do not share the file or mount it wholesale into containers. File permissions do not protect against the same macOS user or a compromised administrator account.

After building the account-capable backend image, stop/review the existing backend before replacement; the helper refuses an existing `caitlyn-fxembed` container. Use an existing private broker socket directory for the separate API key:

```bash
node --import tsx scripts/fxEmbed/manage.ts start-env \
  colima-caitlyn-media-test /private/socket-directory/fxembed.key
```

`start-env` reads the repository-root `.env` (not an arbitrary current working directory or exported X variables). It requires an owner-only non-symlink regular file, limits it to 64 KiB, rejects missing/malformed/duplicate account fields, and selects only those three values. It never populates `process.env` or sends other `.env` settings to Docker. The existing encrypted-stdin/private-tmpfs path below remains unchanged. No account secret is baked into a build or placed in Docker environment/arguments. The bot, broker and diagnostic scripts use `core/loadEnvironment.ts`, which preserves normal environment overrides while excluding `FXEMBED_X_*` from `process.env` and child-process inheritance.

Start/restart the broker with `SOCIAL_FXEMBED_KEY_FILE` pointing to that same private key file (see the example below). The `.env` cookies are read only when starting FxEmbed; editing them does not live-reload the running backend. Expired/revoked sessions must be updated and the backend recreated. Ordinary anonymous `start` remains available and does not implicitly enable accounts. This local file option does not deploy to the homeserver or configure unattended container restarts.

## Optional: authorized X account from 1Password

This alternative is not required for local `.env` startup. Store `username` (handle without `@`), `auth_token` and `ct0` in one 1Password item; use concealed/password fields for both cookies. Never paste them into chat, terminal arguments or tracked project files. The existing 1Password CLI must be unlocked and allowed to access the selected item. Account passwords are not used.

After building the image, stop/review the existing FxEmbed container before replacing it. The helper deliberately refuses an existing container name. The key-file parent must already be an owner-only directory (0700), outside the repository; using the broker's existing private socket directory is appropriate.

```bash
node --import tsx scripts/fxEmbed/manage.ts start-account \
  colima-caitlyn-media-test VAULT_NAME ITEM_NAME /private/socket-directory/fxembed.key
```

The helper reads only the explicitly selected item, validates the three fields, encrypts one account using upstream-compatible AES-256-GCM, and sends the encrypted payload/key over Docker stdin. The 1Password path does not persist a host copy; the local `.env` path intentionally reads the owner's existing plaintext file. Neither path puts session values in Docker environment, arguments, images, build context or logs. The container holds runtime configuration in `/tmp/caitlyn-fxembed/wrangler.json` (0600 within a 0700 directory on tmpfs); it is not persistent secret storage. The isolated process must hold decrypted credentials in memory to call X. Processes running as the operator, Docker administrators and root remain trusted; this does not protect secrets from a compromised host or Docker engine.

A separate random local API key is created as a 0600 file, or an existing valid owner-only key is reused. Only its **path** is provided to the broker:

```bash
SOCIAL_FXEMBED_KEY_FILE=/private/socket-directory/fxembed.key \
SOCIAL_WORKER_DOCKER_CONTEXT=colima-caitlyn-media-test \
SOCIAL_WORKER_IMAGE=caitlyn-media-api:local \
SOCIAL_FXEMBED_URL=http://127.0.0.1:8787 \
SOCIAL_WORKER_SOCKET=/private/socket-directory/worker.sock \
node --import tsx scripts/socialWorker/server.ts
```

Account mode authenticates every local route, including health, before initialization or upstream requests. The broker never receives X session cookies. The wrapper removes incoming headers before passing requests to FxEmbed, exposes only single-post metadata, and marks responses `no-store`. Missing/partial configuration and decryption failures fail closed; `accountConfigured: true` means the local credential store decrypted, **not** that X accepted it or that every post is accessible. The vendored upstream extractor still owns its normal X request/retry behavior. Restricted/protected/unavailable results preserve the original Discord message.

Restarting the container does not restore its temporary secrets: recreate it with `start-env`, or use `start-account` and approve 1Password access again. If X expires or revokes the session, update both cookie fields in your chosen source, recreate the backend, and re-test an authorized post. There is no background vault polling, credential rotation, cloud credential upload, or autostart.

## Restricted posts and maintenance

[FxEmbed's own credential documentation](https://docs.fxembed.com/deployment/credentials/) says anonymous operation cannot fetch NSFW posts and has lower rate limits. Migrating to FxEmbed does not guarantee age-restricted posts will work anonymously. Protected, login/age-denied or unavailable responses preserve the original source. Authorized account setup is described above; the removed VX session-file setting is not supported. See the latest handoff for the actual live account/test status.

The pinned source and lockfile are intentionally not auto-updated. Review upstream changes, the compatibility transform, license and install inventory; rebuild and run the offline tests and approved public-post smoke checks before replacing a working image. Do not run upstream deployment or credential-upload scripts as part of local testing.

## Verified local checkpoint

See [handoff](handoff.md) for live process IDs and image hashes. All 295 vendored files match their upstream Git blobs; checksums are in [the source manifest](fxembed-source-manifest.json). The quality gate passes 275 tests with one optional PostgreSQL skip; the earlier five offline Python tests also passed. Public text/image/gallery/video/quote checks passed with zero media omissions. On 2026-09-13 the owner-provided `.env` session was activated: the previously age-denied test post returned ready metadata and a verified 1,769,698-byte video attachment with a complete renderer payload and zero omissions. A public text regression still passes. The account-enabled backend is running locally; these probes did not send to Discord. Manual Discord playback, sender mention and source deletion still require fresh messages.
