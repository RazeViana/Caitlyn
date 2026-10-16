# Self-hosted Discord previews

Caitlyn posts a link to a separate FxEmbed instance and lets Discord render the post. The native card footer says `Shared by @username`, using the member's Discord username rather than a server nickname or global display name. It does not download, compress or upload media in this mode. `/social` channel settings, PostgreSQL jobs, cancellation, uncertain-send recovery and Caitlyn's normal guild logger still apply.

Set these bot settings only after the public endpoint has passed its external HTTPS and provider checks:

```dotenv
SOCIAL_DELIVERY_MODE=embed
SOCIAL_EMBED_ORIGIN=https://embed.razeviana.com
```

The default remains `SOCIAL_DELIVERY_MODE=attachments` for existing installations. Embed mode does not require `SOCIAL_WORKER_SOCKET`. Retain `SOCIAL_EMBED_ORIGIN` if reverting to attachment mode so earlier link previews can still be identified for edit/delete cleanup.

The replacement contains the member's commentary and the rewritten link, with attribution in the card footer. It is a standalone message so deleting the original does not leave a broken reply. Once every supported link from the source has a durably confirmed replacement, Caitlyn checks the source and copied commentary again and deletes the original. A failed or uncertain send, missing Manage Messages permission, changed source, uncopied attachment/sticker/poll/reply/thread, or commentary exceeding Discord's message limit keeps the original. Earlier native previews that did not copy commentary remain retained; this update does not delete historical originals.

Discord generates the remote card asynchronously. Deletion depends on the confirmed replacement message, not the remote card loading: that message retains the link and commentary if a provider is unavailable. Edits/deletions before replacement cancel pending work and remove its bot preview using the existing durable queue. Bot-initiated source deletion is marked before contacting Discord so its deletion event cannot remove the replacement. An uncertain send is reconciled by its persisted message ID or Discord nonce, bot identity and expected preview URL; it is never blindly repeated. Username changes do not invalidate already-sent previews.

## Separate Mainframe instance

The installed address is **embed.razeviana.com**. TrueNAS app `caitlyn-embeds` publishes `192.168.2.43:3081` to its container port `8787`. The owner configured the existing Cloudflare tunnel to route this hostname to `http://192.168.2.43:3081`, preserving the public Host header. Discord must be able to access the hostname without an interactive Access login or browser challenge. No other public route was changed.

The instance uses the same pinned upstream FxEmbed source (`5b5b6207d9fd93bae15a68ab659fbc97cdbf61b5`) and installed dependencies as the private backend. It has no Discord token, database access, X account session, host mounts, Docker socket or GPU. Public X access is anonymous; posts requiring sign-in can fail. TikTok and Instagram also remain subject to their public-access restrictions.

Build from the committed `scripts/fxEmbedPublic` directory:

```sh
docker build --network none \
  --build-arg FXEMBED_PUBLIC_ORIGIN=https://embed.razeviana.com \
  -t caitlyn-fxembed-public:<revision> scripts/fxEmbedPublic
```

The Dockerfile pins the existing production FxEmbed base by registry digest. No package installation or upstream source update occurs during this build. Record the resulting immutable image ID and revision, generate the Compose object with `publicFxCompose` from `scripts/fxEmbedPublic/compose.mjs`, and create/update the app through TrueNAS middleware. The public instance is managed independently of the four-image bot updater.

The container runs as UID/GID 1000 with a read-only root, dropped capabilities, one CPU, 1 GiB RAM, a process limit, and temporary runtime/cache files. `/healthz` tests local runtime readiness; it does not prove upstream availability. Docker health and content-free startup/exit diagnostics use a rotating local log. Upstream console content logging is suppressed; bot delivery outcomes continue through Caitlyn's existing logger.

## One domain and native cards

X keeps `/handle/status/id`, Instagram keeps `/p/code` or `/reel/code`, and TikTok keeps `/@handle/video/id`. TikTok short links map to `/t/code`. The bot's existing supported-link list remains authoritative; unsupported links remain untouched.

The public wrapper selects the provider from a validated route. Asserted build transforms add the provider to FxEmbed's encoded activity-card identifier so Discord's follow-up `/api/v1/statuses/...` request reaches the right renderer on the shared domain. oEmbed links also identify their platform. FxEmbed itself produces the card text, media, quotes and engagement formatting; Caitlyn does not reconstruct the post.

An attributed preview URL carries a validated `shared_by` username. This distinguishes different sharers in Discord's preview cache. The public wrapper carries it into that card's oEmbed link and sets `provider_name` to `Shared by @username`, the branding footer used by FxEmbed's native activity card. The original social author and media remain unchanged. Attribution is applied to each response without mutating shared branding, and the username is removed before calling the provider renderer. It is display metadata, not an authentication claim or access-control mechanism. [Discord's preview documentation](https://docs.discord.com/developers/link-previews/overview) describes oEmbed provider metadata and URL-based caching; the native activity-card layout is controlled by Discord.

Public requests are limited to previews, activity/oEmbed helpers, health and TikTok's video proxy. Account/profile/search APIs and the private metadata API are not exposed. Caller cookies, authorization and private headers are discarded. Every outbound request and followed redirect must use HTTPS on an allowed social-provider/CDN domain; credentials are removed on cross-origin redirects. There is an eight-request concurrency ceiling and a 180-request/minute process budget. TikTok media streams allow byte ranges, cap transfer at 256 MiB and close after two minutes. These are bounded service limits, not Discord attachment limits. No media archive is created by this service.

## Checks and rollback

The public instance was verified on **2026-10-16 at 16:11 CEST (Europe/Amsterdam)**. TrueNAS create job **286165** succeeded and the service is healthy. Its first runtime exited with code 1; the configured restart policy recovered it at 16:04:54 CEST, with no further restarts observed through the bot rollout. The initial runtime's exit reason is unavailable because its output is suppressed. It uses image `sha256:f2847825a96507b06ae03e44874045a5c47324a6b68d15f5b3e817005f967b7a`, tagged `caitlyn-fxembed-public:7410312ad33d`, built from the committed public-service files at `7410312ad33d5ee40d7f201302deb29623cb21b9`. The inventory contains Node 24.19.0, 88 OS packages and 583 npm entries, unchanged from its pinned base. This service is independent of subsequent bot releases.

External HTTPS checks passed real X text, video, gallery and quote cards, TikTok and Instagram. Every fixture returned its activity data and oEmbed metadata; TikTok video returned HTTP 206 and the requested 1,024-byte range. Private metadata/search routes and a private-address proxy request returned 404, while a browser request redirected to the original post. Measured initial-card responses ranged from 219 to 1,628 ms; these are individual HTTP checks, not Discord rendering measurements. Earlier quote and TikTok follow-up failures cleared on retry, so upstream availability is still a limitation. No Discord test message was sent.

Private configuration backups, image inventory and verification evidence are under `/root/.config/caitlyn-fxembed-public-20261016`. The temporary canary container was removed after the permanent instance passed its public checks. The bot changes are merged in [PR #13](https://github.com/RazeViana/Caitlyn/pull/13); see [the current production installation](mainframe-installations.md) for the activated bot revision.

Run the repository quality gate and `tests/fxPublic.test.js`. Check local health and rejected routes, then fetch an ordinary public post using `User-Agent: Discordbot/2.0`. Follow its oEmbed and activity links and verify actual image/video references; an HTTP 200 with an error card does not count as a successful post preview. Test a TikTok byte-range request and a human redirect to the original source. Repeat through the public hostname before enabling embed delivery.

Save the old bot configuration and image set before activation. To revert posting, set `SOCIAL_DELIVERY_MODE=attachments`, retain the embed origin for reconciliation, and restart/update only Caitlyn through TrueNAS. The prior worker configuration and data remain available. Stopping the new `caitlyn-embeds` app is independent of recording, the database, the website and the stopped SHUSH test bot. Remove a public tunnel route only if the preview service is intentionally retired.
