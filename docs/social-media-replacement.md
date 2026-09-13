# Social-media replacement

Checkpoint: 2026-09-12. Branch: `codex/social-media-replacement`, based on `caitlyn-3.0`.

Later that day, the owner authorized using the existing bot locally while the homeserver instance is inactive. Migrations `014`/`015` are now applied to the local restored DB, all 14 guild commands are registered, and one local bot/worker is running with process-only social opt-in. The owner configured a test channel and private logs. Debugging fixed competing local command handlers, ambiguous legacy voice sessions, and media request identity: image, video, the exact failing post, and both quoted clips now pass through the real worker/renderer with zero omissions. Actual Discord playback after the repair still needs the owner's retest. See [the current handoff](handoff.md#latest-continuation-authorized-local-discord-test-2026-09-12).

## Current status

Latest continuation: added sender-only mentions, copied source captions, and durable deletion of unchanged originals only after all expected previews are complete. Migration `016` is applied locally and does not authorize deletion of old sources. The owner then explicitly removed the extra channel-age check for public sensitive-labelled metadata; protected or X age/login-blocked posts remain unavailable. Current quality gate: 221 tests passed plus one optional PG skip; disposable PG suite: 18 passed. The paragraphs below retain earlier adapter checkpoints; [social delivery](social-delivery.md) defines the current behavior.

The owner approved a full replacement for hosted embed fixers and supplied public X, TikTok, and Reddit examples. The feasibility checkpoint is signed as `03eab46`; the X adapter/renderer checkpoint is signed as `0f3dee4`. Subsequent worker/queue/configuration integration and fixes are implemented but uncommitted. **The replacement remains disabled by default; it is enabled only in the authorized Mac test process and opted-in channel.** `messages/socialMediaMessage.ts` now enqueues opted-in X jobs; hosted-fixer rewrites/deletions are removed from this branch. Other platforms stay as original links until their adapters are ready. Nothing was merged, pushed, or deployed to the homeserver.

Working assumptions: public posts only, no paid API usage or account cookies, and uploads to Discord rather than a public preview website. Paid-API preference remains unanswered. The owner authorized local isolated media tests, worker/delivery implementation, and the current local Discord test. The homeserver remains unchanged.

## Worker and delivery continuation (2026-09-12)

[Social delivery](social-delivery.md) documents the owner-only Unix broker, fresh isolated worker/gateway jobs, validated attachment transport, durable PostgreSQL queue, administrator `/social` channel controls, original-preserving replies, source edit/delete handling, and conservative uncertain-send recovery. Both the master integration switch and new channels default off. Existing private logging and its main-server restriction are preserved.

Latest verification: `npm run check` passes 211 tests with one optional PostgreSQL skip; the disposable PostgreSQL suite passes all 17 tests. Five offline Python request-safety tests also pass. Initial September 12 tests had HTTP 403 media failures; adding an honest application User-Agent resolved the tested requests. No cookies, authentication, browser impersonation, redirects, or alternate-host fallback were added. The current real worker results and reproducible commands are in [social delivery](social-delivery.md#local-verification-and-operator-setup).

No new packages were installed; only the existing image's source layer changed. Test media/containers/volumes/sockets and the disposable database were removed. The dedicated Colima VM is intentionally running for the authorized local bot. Live Discord playback retesting remains open; production deployment requires separate authorization.

## X adapter and renderer continuation

Implemented `core/socialXPost.ts` with bounded full-text extraction (including long-form notes), original image URLs, ordered galleries/mixed media, separate parent/quote authors and media, and explicit partial/unavailable/restricted outcomes. IDs stay strings and must match the requested post. One quoted-post level and four media items per post are supported; nested quotes, cards/articles, malformed media, and missing text/attribution remain explicit gaps. Protected/sensitive/unavailable posts are not downloaded. CDN URL validation supplements—not replaces—the existing gateway.

`core/socialPostRender.ts` builds a single Discord payload from normalized posts and already validated in-memory media buffers. It does not fetch URLs or send messages. Parent/quote cards retain attribution; images refer to attachments; video files carry source-specific names/descriptions. Mentions are disabled and display text is escaped. Cards use bounded descriptions, with full extracted text attached as a `.txt` when it fits; otherwise the shortened-text notice points to the original. Missing/oversized media is labelled. Callers must provide actual attachment/request budgets; 128 KiB is reserved for bounded UTF-8 payload and multipart overhead. It does not infer server upload limits from a hard-coded guild.

The local `--x-post` mode retrieves raw GraphQL structure through the pinned extractor's public guest route, normalizes it **inside** the worker, and emits only counts, IDs, issue codes, and media validation summaries. It deliberately skips the extractor's legacy conversion and automatic HTTP-429 endpoint fallback. It uses no account login/cookies/paid API. This is an unofficial, changeable access mechanism, not a guaranteed production API contract. No returned card URL is followed.

Historical complete sample run: **12:53:49–12:54:00 UTC, 2026-09-10**. All five isolation checks and normalized metadata outcomes passed; all reported media was downloaded and validated at that time:

| X case | Text and attribution | Original media verified |
| --- | --- | --- |
| One picture | 125 characters; author present | One 398,830-byte PNG, 853×580 |
| Gallery | 145 characters; author present | Two ordered JPEGs: 49,034 bytes at 552×552 and 27,509 bytes at 525×525 |
| Video | 145 characters; author present | 3,162,626-byte H.264/AAC MP4, 480×270, 141.18 s |
| Text | 163 characters; author present | No attached media reported |
| Quoted post | Parent: 91 characters; quote: 57; distinct authors/post IDs | **Two separate videos**: parent 786,568 bytes, 1280×720, 8.68 s; quote 1,857,428 bytes, 1806×1080, 6.94 s; both H.264/AAC |

Text completeness means the provider's full-text/note field was retained within the cap, without an explicit truncation flag or missing note. GraphQL commonly omits the legacy `truncated` field. Text/appearance has not been visually compared against X or Discord. Images passed original-dimension/MIME/codec checks and one-frame decode; videos passed duration/codec/audio checks and first-two-second decode, not full-file or Discord playback testing.

Video candidates are ordered by quality and conservatively filtered using duration/bitrate plus overhead. The worker enforces actual bytes independently: 10 MiB per X video, 12 MiB per image, at most four video attempts (only byte overflow permits a smaller variant), and the existing case-wide time/resource/egress limits. These are local budgets, **not Discord limit assumptions**. No re-encoding is attempted. Missing audio on a regular video stays `audio_unverified`; silent animated GIFs are handled separately.

Added 24 offline tests covering normalization, malformed/restricted responses, quote separation, Unicode bounds, mention safety, rendering/upload budgets, byte-limit fallback, terminal access failures, duration/codec/audio mismatches, image bounds, and decode failures. `npm run check`: **173 passed, one optional PostgreSQL test skipped**, with typecheck/lint/build passing. No new packages were installed; only the cached image's source layer changed. Full pre-existing runtime/dependency inventory: [media-test installations](media-test-installations.md).

Next: design the production worker response/validated-file transport, durable job/delivery state and retry rules, original-message preservation, per-server opt-in controls, and guild-scoped operational logging. Then run injected Discord/DB integration tests and a separately authorized live Discord check. Do not connect the local Docker diagnostic directly to `messageCreate`; it intentionally deletes downloaded files and returns no delivery-ready bytes.

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

1. **Finish the authorized local X retest.** The queue/transport/configuration, command registration, local migrations, and worker activation are complete. Media request identity is fixed for the tested posts. Verify native video playback/audio on desktop/mobile, command responses, real permission failures, and edit/delete cleanup. Do not infer complete media support from a text-only partial result.
2. **Prepare production hosting.** The trusted local broker exists, but a reviewed production image build, service supervision, private socket/UID mapping, resource monitoring, and orphan-cleanup procedure are still needed. The bot image/deployment remains unchanged. Keep bot/database credentials, host directories, and Docker control sockets outside media containers. Homeserver changes require separate authorization.
3. **Complete the remaining platform adapters.** Agree paid/API access and add Instagram/TikTok/approved Reddit handling with the same media ownership, bounded processing, partial outcomes, and network protections. Existing diagnostic successes are not finished adapters. Review all new manifests/subrequests/redirects; retain private-IP/CGNAT blocking and stop on access restrictions. Owner-supplied Instagram samples remain useful.
4. **Roll out only after validation.** Hosted-fixer rewrites are gone from this branch, but the new X path stays opt-in and unsupported platforms stay original-only. Broader platform/media coverage and production rollout are unfinished. No hosted-fixer fallback, implicit merge/push, command publication, production migration, or deployment is authorized by this implementation checkpoint.
