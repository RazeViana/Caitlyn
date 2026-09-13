# TikTok video previews

TikTok uses the same opt-in channels, durable queue, sender-only mentions, native typing feedback, clean `Caitlyn preview` footer, and safe source cleanup as X. `/social enable` enables both platforms in that channel. The global social feature remains off by default. No TikTok API key, browser login, new package, or database migration is required.

## Supported content and limits

- Canonical `tiktok.com/@creator/video/ID` links, including recognized mobile/www aliases and tracking parameters.
- `vm.tiktok.com`, `vt.tiktok.com`, and `www.tiktok.com/t/` share links. Resolution is bounded and happens only inside the isolated worker. Redirects to private/unapproved hosts, login pages, profiles, and unsupported routes do not trigger extraction.
- Caption-first cards with creator attribution, plus a verified H.264/AAC MP4 uploaded to Discord. A compact `TikTok · Video · Original ↗` line and clickable author open the canonical source; there is no large link title or duplicate video thumbnail. `Shared by @sender` sits inside the main card below the caption/source line. Sender commentary is kept separately above the card without handled source URLs; link-only shares have no standalone text. Missing captions add no filler; long captions use a full-text attachment. See [shared presentation behavior](social-delivery.md#behavior-and-configuration).
- At most 8 MiB per attachment, 20 MiB aggregate, and 15 minutes of video. These are Caitlyn's conservative budgets, not a claim about a particular server's Discord limit. Known oversized formats are skipped; actual streaming bytes remain bounded. Only a size failure permits another candidate, with a four-candidate maximum. No transcoding, splitting, muted-audio fallback, or cap bypass is attempted.

Photo slideshows, live streams, audio-only posts, incompatible formats, and logged-in/private content are not supported in this slice. A standalone unsupported link stays untouched. Failed/partial video previews preserve their original message; partial cards explicitly say media is missing. Unsupported links in mixed-source captions remain visible rather than being silently removed. Actual provider access restrictions and rate limits are terminal; temporary worker/timeouts retain the existing bounded retry policy.

## Extraction and privacy

The existing hash-pinned `yt-dlp 2026.08.19` TikTok extractor runs in the network-none container, not in the Discord bot. It retrieves public metadata through a fresh TikTok-only gateway. The X gateway is likewise restricted to X/CDN hosts. Both retain public IPv4 DNS validation/pinning, HTTPS-only tunnels, private/loopback/Tailscale rejection, traffic/time/process/memory limits, and disposable storage.

TikTok media can require the request context that produced its signed CDN URLs. The extractor's anonymous user agent, canonical referer, and domain-scoped anonymous cookies are saved in fixed 0600 files in the worker's temporary filesystem and reused by its media downloader. They are created by this job's public-page requests only. No host/browser cookie file, TikTok account, `.env` credential, or X session is supplied. This context is never returned to the broker, included in Docker configuration, or logged, and disappears when the worker is removed. Signed media URLs travel between subprocesses over stdin, not command arguments.

Metadata response reads are capped at 2 MiB, serialized metadata at 1 MiB, extraction at 45 seconds, and each media subprocess at 20 seconds. Redirect targets are checked before connecting; a media request permits at most three redirects. The shared verifier checks actual bytes, H.264 video, AAC audio, dimensions, duration, and a two-second decode with network protocols disabled. No raw extractor errors, captions, cookies, request headers, or signed CDN URLs enter the shared logs.

TikTok queue identities are namespaced, so X and TikTok cannot collide even when numeric IDs match. Legacy X database keys stay unchanged. Share tokens keep their original hashed identity for source cleanup. After extraction, a leased transaction binds the job to its canonical video URL and can reuse a confirmed complete same-source preview for another alias. Ambiguous/partial/cancelled siblings never authorize another send or source deletion. Mixed X/TikTok sources require all expected job identities to be complete before deletion.

The existing broker and database/socket checks apply. TikTok does not depend on FxEmbed being available; malformed/missing X backend configuration is logged without disabling TikTok. `/v1/tiktok` is a delivery-only route; the X metadata-only route does not accept TikTok URLs. No request can select an extractor, Docker image, arbitrary headers, cookie file, or filesystem output path.

## Local verification

The full local path retrieved **2,953,029 bytes** from TikTok's [official embed example](https://developers.tiktok.com/docs/en/embed-videos), verified video/audio/decode, and produced a complete one-embed/one-MP4 payload on 2026-09-13. The supplied `nicoiscold` example's compatible format was approximately 37 MB; the job returned an explicitly partial `size_limit` result rather than exceeding the 8 MiB cap. An older upstream example failed extraction. Old mobile-share samples did not resolve to a post; a checked `/t/` token redirected to TikTok's homepage. Unsupported destinations now report `unsupported`, not an assumed account restriction. Fresh mobile links and actual Discord playback still need owner testing; one successful clip is not a platform-wide guarantee. No diagnostic sent or deleted a Discord message.

Tests cover cross-platform identities, malformed responses, hostile URLs, byte limits, unsupported content, media failures, isolated Unix routing, and alias/source cleanup. Python tests use mocked requests in the already installed sandbox runtime. The disposable PostgreSQL suite checks real mixed-platform/alias transitions and removes its own synthetic database afterwards. See [handoff](handoff.md) for final test counts, current image/process identities, command registration, and live activation status.

Build a source-only candidate without installing dependencies or replacing the existing worker tag:

```bash
node --import tsx scripts/buildSocialWorkerImage.ts \
  colima-caitlyn-media-test caitlyn-media-api:local caitlyn-media-tiktok:local

SOCIAL_WORKER_IMAGE=caitlyn-media-tiktok:local \
node --import tsx scripts/testSocialDeliveryLocal.ts \
  https://www.tiktok.com/@scout2015/video/6718335390845095173
```

The diagnostic also accepts a supported TikTok share URL. It logs only counts and closed outcomes, cleans up its own socket/containers/media, and never logs into Discord. An incomplete result intentionally exits nonzero. The broker resolves an image tag at startup, so rebuilding a tag alone does not update a running broker. Existing `/social` command descriptions need targeted guild registration when activating this version; no new command name is introduced.

## Remaining work

Manual Discord desktop/mobile playback and original-message cleanup still need a fresh owner-sent TikTok link. Photo galleries with their soundtracks, larger-media strategy, account-only access, and homeserver service supervision are separate work. TikTok's [official oEmbed interface](https://developers.tiktok.com/docs/en/embed-videos) supplies player markup, not the verified attachment workflow; the [pinned extractor source](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/tiktok.py) is an external dependency retained inside the worker, not a hosted embed service.
