# Social-media replacement

Checkpoint: 2026-09-10. Branch: `codex/social-media-replacement`, based on `caitlyn-3.0`.

## Current status

The owner approved investigating a full replacement for hosted embed fixers and supplied public X, TikTok, and Reddit examples. This checkpoint implements offline link recognition and a repeatable official-endpoint diagnostic. **The full replacement is not implemented or enabled.** `messages/socialMediaMessage.ts` still uses the existing rewrite flow and has not been connected to the new parser.

Working assumptions: public posts only, no paid API usage or account cookies, and eventual uploads to Discord rather than a public preview website. Paid-API preference remains unanswered. The initial endpoint check used no credentials or media downloads. The owner subsequently authorized local isolated media tests, documented below. No database changes, Discord login/messages, deployment, or homeserver changes were involved.

## Local isolated media checkpoint

The owner selected local testing. Installed Colima/Docker locally and ran a disposable, non-root, network-none media worker through a restricted Unix-socket gateway, with no credentials or host mounts. All live isolation checks passed. Actual X video and quote clips downloaded with H.264/AAC and passed a two-second decode check. Instagram examples produced decodable H.264 files without audio streams; audio completeness is unverified. TikTok reached its CDN but exceeded the 32 MiB test cap. X image/gallery/text require a separate extractor; Reddit remains gated.

The final complete run, limits, exact sizes/codecs, commands, cleanup, and caveats are in [local media testing](local-media-testing.md). All case containers, IPC volumes, and test downloads were removed, and the named VM was stopped; tools/images remain for reuse. `npm run check` passes 149 tests with one optional database test skipped. The current bot handler is still unchanged; these are feasibility tools, not a production replacement.

## Live endpoint checks

Requests ran from this Mac on 2026-09-10 against official oEmbed endpoints, each with an eight-second abort deadline and a 256 KiB decoded-body cap. No redirects, returned HTML, image URLs, or video URLs were followed. Responses were summarized in memory; raw bodies, post text, and signed media URLs were not saved.

The diagnostic's `metadata` outcome means only recognized oEmbed markup was returned. It does **not** verify post availability, rendering, complete text, gallery size, quoted-post relationships, or playable video/audio. Generic Instagram embed HTML is especially weak evidence of actual post availability.

| Owner's example | Official-endpoint result | Still unverified |
| --- | --- | --- |
| [X: one picture](https://x.com/TheHiddenOneAC/status/2097940988492664992) | HTTP 200; author and HTML; no thumbnail field | Original image and complete text |
| [X: multiple pictures](https://x.com/HeyShuggie/status/2097725753634755034) | HTTP 200; author and HTML; no thumbnail field | Complete gallery, ordering, attribution |
| [X: video](https://x.com/iClipCx/status/2097745425323209202) | HTTP 200; author and HTML; no thumbnail field | Video, audio, codecs, upload size |
| [X: text](https://x.com/MasterLeytrx/status/2097877698894770267) | HTTP 200; author and HTML; no separate title field | Complete, safely rendered text |
| [X: quoted post](https://x.com/The_Kurieta/status/2097925042214457837) | HTTP 200; author and HTML | Parent/quote relationship and each post's media |
| [TikTok: video](https://www.tiktok.com/@nicoiscold/video/7675179840605015310) | HTTP 200; author, HTML, thumbnail field; title empty/absent | Original video, audio, attribution, upload size |
| [Reddit: video](https://www.reddit.com/r/MMALabs/comments/1wbll2j/rei_miyamoto_vs_toshizo_man_vs_woman_fight/) | No API request: `approval_required` | Approved access, video/audio retrieval |
| [Reddit: image](https://www.reddit.com/r/classicwow/comments/1wb10d0/closed_dark_portal/) | No API request: `approval_required` | Approved access, original image |
| [Reddit: text](https://www.reddit.com/r/classicwow/comments/1wc5drd/i_have_never_been_this_hyped_for_a_blizzcon_and_i/) | No API request: `approval_required` | Approved access, complete text |

The X `/video/1` URL and plain status URL became one post key and caused only one probe. IDs remain strings to avoid JavaScript number-precision loss. Probing a post does not probe its quoted post or attached media.

No owner-supplied Instagram samples yet. Supplementary public examples were [Meta's example post](https://www.instagram.com/p/fA9uwTtkSN/), [an Instagram reel](https://www.instagram.com/reel/Chunk8-jurw/), and [a multi-video post](https://www.instagram.com/p/BQ0eAlwhDrw/). All returned HTTP 200 and HTML, without author/title/thumbnail fields. Sample sources: [Meta's official plugin](https://github.com/facebook/meta-embeds-for-wordpress) and [yt-dlp's Instagram tests](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/instagram.py). These are not a verified photo-gallery test set.

Initial browsing-service checks could not retrieve X/TikTok pages; the later local endpoint checks succeeded. The browsing service read the Reddit image/text pages, which is neither a bot API test nor evidence of approved API access. Initial sandboxed local requests returned network errors; HTTP results above came from the separately permitted network run.

## Findings that affect the implementation

- X's [oEmbed API](https://docs.x.com/x-for-websites/oembed-api) supplies website embed markup; its [data API uses paid credits](https://docs.x.com/x-api/getting-started/pricing). No paid calls were made. Markup is not a structured media API response.
- TikTok's [oEmbed API](https://developers.tiktok.com/docs/en/embed-videos) provides player markup and metadata. Its [Display API video query](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query) checks that videos belong to the authorized user; it is not general access to arbitrary shared posts.
- Meta's [official plugin](https://github.com/facebook/meta-embeds-for-wordpress) documents tokenless Instagram oEmbed at `graph.facebook.com/v25.0/instagram_oembed`. This website integration does not establish general original-media access; do not use obsolete token assumptions or treat HTML as a download manifest.
- Reddit's [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) requires explicit approval before API access. The diagnostic stops without making that request. Do not substitute anonymous `.json`, alternate hosts, or extractors to bypass the access decision.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) is a candidate video component, not a whole-post renderer. Its current [X extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py) excludes photos from video selection and can select quoted-post videos. We need separate metadata/image handling and an explicit parent/quote model. Source inspection is not a successful extractor run.
- Discord's [message API](https://docs.discord.com/developers/resources/message#create-message) does not let bots set arbitrary video fields in rich embeds. Proposed delivery is validated attachments plus our attribution/text cards, not pasted oEmbed HTML. Respect applicable upload limits.

## Implemented and tested

- `types/socialMedia.ts`: canonical post/share identities.
- `core/socialLinks.ts`: network-free recognition of known hosts/routes; HTTPS normalization; query/fragment stripping; platform/post-ID deduplication; X media suffixes; mobile aliases; Instagram posts/reels; Reddit posts/galleries/`redd.it`; TikTok video/photo routes; selected unresolved share links. Share keys are hashes, not full URLs.
- `scripts/probeSocialMedia.ts`: official fixed-endpoint requests, Reddit access gate, no redirects/credentials, abortable request/body reads, bounded JSON, safe outcome categories. Its CLI uses the existing logger but never starts Discord or its log forwarder. Importing functions makes no network requests.
- `tests/socialLinks.test.js` and `tests/socialMediaProbe.test.js`: 17 offline tests covering the owner's URLs, tracking/duplicates, hostile authorities, hidden content, bounds, request/body timeouts, invalid responses, HTTP/rate-limit failures, and safe logging. All network tests use injected responses.

The parser caps results at five unique links per message, rejects messages over 20,000 characters and URLs over 2,048 characters, and ignores code, spoilers, and explicitly suppressed embeds. Unfinished hidden/code regions remain hidden. It is not a complete Discord Markdown parser. Profiles, stories, comment-specific Reddit URLs, arbitrary shorteners, encoded paths, unknown routes, and ambiguous authorities are rejected. Share links are recognized but **not resolved**. Original message content is not modified.

URL recognition is **not** SSRF protection. The diagnostic contacts fixed provider endpoints only. Do not send accepted URLs directly to a general downloader or run one with access to the homeserver's private services.

### Run the diagnostic

From the repository root, pass one to ten public post URLs explicitly:

```bash
node --import tsx scripts/probeSocialMedia.ts \
  'https://x.com/iClipCx/status/2097745425323209202/video/1' \
  'https://x.com/iClipCx/status/2097745425323209202' \
  'https://www.tiktok.com/@nicoiscold/video/7675179840605015310'
```

Duplicate keys are skipped. Requests are sequential, at most eight seconds each, without retries (including HTTP 429). Exit `0`: all unique inputs returned recognized markup, **not verified media**. Exit `1`: one or more inputs were gated/unavailable/invalid or failed. Exit `2`: invalid CLI argument count. Never supply cookies, API tokens, private links, or authentication headers.

Verification: `npm run check` passed typechecking, lint, a clean build, and 145 tests with one opt-in PostgreSQL test skipped. No migrations were added or applied. Files follow the project's header/folder conventions.

## Next implementation gates

1. **Complete media feasibility.** Agree access methods and paid-API preference. Verify full text, original images/galleries, video/audio, mixed media, quoted posts, deleted/private/age-restricted posts, and expiring URLs. Restricted/disallowed content stays unavailable; no cookie harvesting or anti-bot bypasses. Owner-supplied Instagram samples remain useful.
2. **Promote the tested isolation design into a production worker.** Local Colima/Docker testing now exists; yt-dlp/FFmpeg are installed only inside its image. Keep bot/database credentials and home directories out of the worker, and preserve tested egress limits. The existing bot image has not changed. This diagnostic is not a queued production service; homeserver access/changes remain separately authorized.
3. **Protect all network activity.** Validate HTTPS/ports, DNS/IPs, connection pinning, redirects, manifests, segments, and extractor subrequests. Block private, loopback, link-local, metadata-service, and Tailscale/CGNAT destinations at the worker boundary. Bound bytes, redirects, duration, CPU, disk, concurrency, and total lifetime. Stop on authentication challenges/rate limits.
4. **Build state and delivery.** Add per-platform adapters, distinct parent/quoted media, and explicit partial/unavailable outcomes. Use PostgreSQL for bounded jobs/retries/deduplication; keep transactions short. Scope deliveries by guild/channel/message/post. Preserve originals, attachments, reply context, and spoilers; prevent unintended mentions. Handle upload/perms failures, ambiguous sends, source edits/deletions, cache expiry, and shutdown.
5. **Integrate configuration/logging.** No hard-coded server IDs. Add per-server/channel/platform controls separately from private operator logging. Use `withLogGuild` and existing severity filters; log safe categories/job IDs, not content/cookies/signed URLs. Keep slow media work off the message-event critical path.
6. **Switch after validation.** Add isolated DB/worker/Discord tests, then separately authorized live checks. Remove the hosted-fixer runtime path only once the replacement preserves originals and fails gracefully. No hosted-fixer fallback is planned for the final replacement. Do not implicitly push, merge, publish commands, migrate production, or deploy.

Initial endpoint checks and local isolated video tests are complete. Full media feasibility and the replacement remain open. Local test hosting is selected; paid-API budget and production worker integration are not decided.
