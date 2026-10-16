# Self-hosted Discord previews

Caitlyn can post an attributed link to a separate FxEmbed instance and let Discord render the post. It does not download, compress or upload media in this mode. `/social` channel settings, PostgreSQL jobs, cancellation, uncertain-send recovery and Caitlyn's normal guild logger still apply.

Set these bot settings only after the public endpoint has passed its external HTTPS and provider checks:

```dotenv
SOCIAL_DELIVERY_MODE=embed
SOCIAL_EMBED_ORIGIN=https://embed.razeviana.com
```

The default remains `SOCIAL_DELIVERY_MODE=attachments` for existing installations. Embed mode does not require `SOCIAL_WORKER_SOCKET`. Retain `SOCIAL_EMBED_ORIGIN` if reverting to attachment mode so earlier link previews can still be identified for edit/delete cleanup.

The preview is a reply containing the sender attribution and the rewritten link. The original remains, preserving commentary, attachments, replies and the source link. Discord generates the remote card asynchronously: confirmation that a message was sent does not prove the preview loaded. Consequently, native-preview sends never authorize source deletion. Edits/deletions to the source cancel pending work and remove its bot preview using the existing durable queue. An uncertain send is reconciled by its persisted message ID or Discord nonce, bot identity, source reference and exact preview content; it is never blindly repeated.

## Separate Mainframe instance

The selected address is **embed.razeviana.com**. The intended TrueNAS app is `caitlyn-embeds`, publishing `192.168.2.43:3081` to its container port `8787`. The existing Cloudflare tunnel should route this hostname to `http://192.168.2.43:3081`, preserving the public Host header. Discord must be able to access the hostname without an interactive Access login or browser challenge. No other public route needs changing.

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

Public requests are limited to previews, activity/oEmbed helpers, health and TikTok's video proxy. Account/profile/search APIs and the private metadata API are not exposed. Caller cookies, authorization and private headers are discarded. Every outbound request and followed redirect must use HTTPS on an allowed social-provider/CDN domain; credentials are removed on cross-origin redirects. There is an eight-request concurrency ceiling and a 180-request/minute process budget. TikTok media streams allow byte ranges, cap transfer at 256 MiB and close after two minutes. These are bounded service limits, not Discord attachment limits. No media archive is created by this service.

## Checks and rollback

Run the repository quality gate and `tests/fxPublic.test.js`. Check local health and rejected routes, then fetch an ordinary public post using `User-Agent: Discordbot/2.0`. Follow its oEmbed and activity links and verify actual image/video references; an HTTP 200 with an error card does not count as a successful post preview. Test a TikTok byte-range request and a human redirect to the original source. Repeat through the public hostname before enabling embed delivery.

Save the old bot configuration and image set before activation. To revert posting, set `SOCIAL_DELIVERY_MODE=attachments`, retain the embed origin for reconciliation, and restart/update only Caitlyn through TrueNAS. The prior worker configuration and data remain available. Stopping the new `caitlyn-embeds` app is independent of recording, the database, the website and the stopped SHUSH test bot. Remove a public tunnel route only if the preview service is intentionally retired.
