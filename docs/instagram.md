# Instagram previews

## Status — 2026-09-18

Photo/reel/carousel support is connected in source. **Both owner-supplied public examples pass real isolated delivery checks without an account, and Instagram is now active in the local bot.** The owner confirmed the homeserver is inactive and approved local startup/registration. Reddit remains parked.

Real checks on 2026-09-18:

- Photo: `https://www.instagram.com/p/DdUCjIygdfq/` — ready, one verified image, 2,438,382 bytes, complete caption/card, no omissions (16:36:43 UTC).
- Reel: `https://www.instagram.com/reel/DdGpKGeo7Lc/` — ready, one verified H.264/AAC MP4 with audio, 5,014,030 bytes, complete caption/card, no omissions (16:37:02 UTC).
- Same reel with a diagnostic 1 MiB upload cap — ready, one compressed MP4 with audio, 905,235 bytes, no omissions (16:38:30 UTC). Actual delivery still uses the normal upload budget; this did not lower production limits.

The initial failures were implementation gaps: the HTML contains a client-rendered shell, and logged-out image candidates omit dimensions. Added the pinned extractor's same-origin public hydration query and let the sandbox probe actual image dimensions when absent from metadata. Public page anti-CSRF values and anonymously issued cookies stay only in worker memory; no account/browser cookies or session credentials are used. No browser impersonation, hosted fixer or alternate-domain fallback was added. No Discord messages were sent by these checks.

## Implementation

- Canonical `/p/` and `/reel/` links lose tracking parameters, preserve case-sensitive shortcodes and share namespaced queue identities across aliases.
- Reuses the installed, hash-pinned **yt-dlp 2026.08.19** [public-page parser and logged-out query](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/instagram.py). Captures product metadata before upstream converts carousels to video-only playlists; does not run authenticated/mobile/impersonation paths.
- Only the public page, one fixed same-origin `/api/graphql` POST when hydration is needed, and validated Instagram/Meta CDN URLs are fetched through the platform-isolated gateway. No redirects, page scripts, comments, manifests or provider-selected paths are executed. Each metadata response is capped at 2 MiB, final metadata at 1 MiB; attachment caps remain 8 MiB individual/20 MiB aggregate. No query retry follows denial.
- Preserves captions, authors, selected image dimensions and up to eight ordered carousel items. Missing text/items, duplicate or malformed children, unsupported video sources and larger carousels stay partial. Python converts numeric media IDs to decimal strings before JavaScript sees them.
- Reuses shared image validation and H.264/AAC video verification/compression. Only size failures permit candidate fallback/compression; access errors and timeouts halt the remaining carousel. Unknown audio is not silence. Explicitly silent clips use original-only MP4 delivery (shared GIF verification policy), but are labelled Video in cards.
- `/v1/instagram` validates identity, file ownership, hashes and byte limits. Signed CDN URLs are stripped at the bot boundary. Cards show caption, compact Original link and Shared by attribution; complete-only source removal/reconciliation remains unchanged.
- Existing private guild-scoped logs show `mode=instagram_public` and allowlisted failure reasons, never raw captions, URLs, response bodies or provider errors.
- Explicit `private_post`, `login_required` or HTTP 401 responses produce a formatted lock-icon card with an Open on Instagram link and sender attribution. It replies without pinging or copying commentary, keeps the original, and uses the same durable send claim/nonce/reconciliation. Notices are never marked complete replacements. A 403, rate limit, challenge, generic redirect, empty metadata or deleted/unavailable result is **not** called private. Public-page login links are not evidence of a restriction.

Unsupported: stories, private/login-gated posts, unresolved share links, DASH-only/split audio-video formats and carousels beyond attachment capacity. Originals are preserved. Real mixed-carousels, native playback and Discord cleanup still need acceptance testing.

## Configuration and activation

No new packages or Instagram environment variables are required for this anonymous path. Existing social enablement, owner-only socket, database and `/social enable` settings apply; missing required social configuration still disables the feature. Instagram is independent of X/FxEmbed credentials.

Local activation completed on 2026-09-18 after owner confirmation. Broker PID **97148** (session **5329**) uses `caitlyn-media-instagram:local` at `sha256:50894c2e409bfcb61d36274cdfa66f5701b965cc38e87c0095de0b4ee18efa4d`; health returned 200/idle with x,tiktok,instagram. Bot PID **318** (session **98628**) came online at **16:41:04 UTC**, using local `127.0.0.1:5432/caitlyn_test`, social enabled and AI disabled. Socket: `/tmp/caitlyn-instagram-runtime-kV7aHH/worker.sock`. Exactly one bot and one broker were confirmed in this checkout; reverify before any later stop.

The old documented bot/broker were already stopped. Their temporary FxEmbed key file had disappeared; the existing local API key was restored privately from the still-running FxEmbed container to `/tmp/caitlyn-instagram-runtime-kV7aHH/fxembed.key` (0700 parent/0600 file), without printing it, changing the service/account or reading browser credentials. The authenticated local health check passed. Older stale sockets were left untouched.

Only `/social` was patched and read back in the configured test guild at **16:40:48 UTC**; other commands/global registrations are unchanged. `.env` and database configuration files are unchanged: runtime settings are process-only overrides. That activation did not change Git branches or the homeserver; the later Instagram integration checkpoint is recorded in [the handoff](handoff.md#instagram-integration-scope-and-verification-2026-09-18).

## Checks

```sh
npm run check
node --import tsx scripts/buildSocialWorkerImage.ts colima-caitlyn-media-test caitlyn-media-shared-compression:local caitlyn-media-instagram:local
node --import tsx scripts/testInstagramMediaOffline.ts
```

The source-only build is offline and rejects changed dependency layers. Ten Python fixtures passed in the existing candidate image with no network, host mounts or credentials, a bounded tmpfs, and explicit cleanup. Full `npm run check` passed **404 tests, one optional PostgreSQL skip (405 total)**, including typecheck, lint and clean build. Tests cover normalization, gallery order, audio policy, compression, transport, rendering, honest access notices and durable send/failure boundaries.

Before committing, the exact Instagram-only staged snapshot was tested independently of the parked Reddit files: **363 tests passed, one optional PostgreSQL skip (364 total)**, with typecheck, lint and clean build. The larger working-copy count above includes the separate uncommitted Reddit tests.

Installation inventory: **no packages/tools installed or upgraded**. This continuation created only two source-image revisions with all seven dependency layers reused: `sha256:402f2f9903e7d765623717df407116dd6f4e194fea8203352ec6e4bbeaf3791b` (intermediate, cached) and `sha256:50894c2e409bfcb61d36274cdfa66f5701b965cc38e87c0095de0b4ee18efa4d` (selected). The previous shared-compression image remains available. Temporary test media, containers, volumes, sockets and staging directories were removed; the intentionally active runtime socket/key and services remain.

`scripts/testSocialDeliveryLocal.ts` can test one canonical URL using `SOCIAL_WORKER_IMAGE=caitlyn-media-instagram:local`. It starts no Discord client and removes its own temporary socket/containers/volume. Real mixed-carousels, actual desktop/mobile playback, private/login notices and source cleanup in Discord remain owner acceptance checks; synthetic fixture success does not establish those outcomes.
