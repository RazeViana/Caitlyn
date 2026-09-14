# Shared, bounded video compression

X and TikTok first try fitting original MP4 formats. If only the byte budget prevents delivery, they can make one larger-source attempt per video and compress locally inside the existing disposable media container. X includes videos in the quoting post and the quoted post, preserving their ownership and order. No hosted compressor, new dependency, browser session or account is used.

`scripts/mediaSandbox/videoDelivery.ts` owns the platform-independent verification/fallback policy; `videoCompression.ts` owns local encoding and completeness checks. Each adapter supplies approved candidates and its existing bounded downloader. TikTok no longer imports the X worker for video verification. A future Reddit adapter will use this same path after supplying a compatible MP4 with its audio; Reddit extraction, authorization/egress and response validation still need implementation and are **not enabled by this change**. The shared helper accepts neither platform credentials nor arbitrary output paths, and does not perform its own URL requests.

## Limits and completeness

- Discord output stays at 8 MiB per attachment and 20 MiB per message. The bot/Unix transport budgets are unchanged.
- Temporary source downloads are capped at 48 MiB, with both declared and streamed sizes checked. A maximum of three direct attempts plus one compression-source attempt retains the existing four-download bound per video. Source selection prefers the smallest eligible candidate. X retains its conservative original-budget probe when estimates exclude all variants; the larger-source attempt never bypasses its source estimate cap.
- Restrictions, HTTP access denial, rate limits, timeouts and invalid media never authorize this fallback or another download. Sources that exceed the temporary cap are not retrieved.
- Source validation still requires H.264/AAC and the existing decode checks. Compression additionally requires exactly one video and one audio stream, at most 1080p-equivalent pixel area, and bounded/consistent stream durations. Alternate audio, subtitle/data streams and missing duration metadata are not silently discarded.
- Encoding uses two single-threaded H.264 passes, at most 20 seconds each, inside the existing one-CPU/512 MiB/read-only/network-none container. The 96 MiB temporary filesystem, 90-second whole-job worker deadline and gateway traffic limits remain unchanged. Multiple X videos share that deadline and the remaining aggregate attachment budget; those limits are not multiplied per clip. Heavy multi-video posts may therefore still fail safely.
- Bitrate targets leave 15% headroom for audio/container overhead. Output is at most 480 pixels on its longest side, falling to 360/240 and 24/15 fps as the budget shrinks. AAC audio uses 64/32 kbit/s; a 48 kbit/s minimum video rate prevents unlimited degradation. Very long clips may still be rejected. These are fixed conservative worker policies, not new user-controlled process arguments.

The source is never split or intentionally shortened. Output must fit the actual byte budget, retain video/audio/container durations within 0.25 seconds of the source, and pass a full audio/video decode before it replaces the temporary input and is uploaded. An emergency FFmpeg file-size cutoff alone is insufficient: [FFmpeg documents](https://ffmpeg.org/ffmpeg.html#Main-options) that it stops output and can slightly exceed the requested size. Truncated, oversized, corrupt, timed-out or otherwise unverified output is discarded with an explicitly partial preview; the original Discord message remains.

Verified compressed video attachments carry a strict boolean marker through the existing response validator for both platforms; images and animated GIFs cannot carry it. Silent X GIFs remain original-only rather than inventing or discarding audio for compression. Each affected card says once that video was compressed and quality is reduced; an uncompressed parent does not inherit its quote's notice. The private guild logger reports compression using only the job ID and fixed message text, never source URLs, captions, bytes, cookies or codec diagnostics. Compressed media can authorize source replacement only after the same complete, confirmed delivery checks as original files. A missing/failed quote attachment still preserves the original message.

## Verification and activation

Unit tests inject process/filesystem operations, including failed passes, shortened output, missing audio, hostile response fields, source caps and terminal access failures. Python tests exercise the enlarged input boundary without networking. A disposable no-network test generated a 15,296,653-byte synthetic H.264/AAC clip and compressed it to 457,485 bytes under a 512 KiB budget, including full-duration decode checks. No test media was written to the host filesystem.

On September 14 (local time), the owner's 654-second `nicoiscold` example returned a complete **7,388,255-byte compressed MP4**, one embed and zero omissions in approximately 35 seconds through the real isolated delivery path. Audio and full duration passed the checks above. The final policy uses the `ultrafast` encoder preset and drops frames before scaling to fit the existing CPU deadlines. The budget reduces this long clip to a 240-pixel longest side and 15 fps; this is a deliberately low-quality fallback, not original-quality delivery. The X example still returned 3,162,626 bytes and the smaller TikTok example 2,953,029 bytes, both uncompressed. Discord playback remains a manual check with fresh owner-sent links.

The source-only image is built offline from the existing dependency layers:

```bash
node --import tsx scripts/buildSocialWorkerImage.ts \
  colima-caitlyn-media-test caitlyn-media-compression:local caitlyn-media-shared-compression:local

SOCIAL_WORKER_IMAGE=caitlyn-media-shared-compression:local \
node --import tsx scripts/testSocialDeliveryLocal.ts tiktok
```

The second command tests the owner's previously oversized example through a temporary private broker and reports only counts/outcomes. It sends no Discord message. See [handoff](handoff.md) for current provider-test results, active process/image identities and whether local activation was approved. Building the image alone does not update a running broker; changing its image requires restart. Nothing was installed in the dependency layers or on the Mac.

The diagnostic accepts a named X case or supported X/TikTok URL, plus an optional second argument for a smaller attachment budget (1 KiB–8 MiB). For example, `video 2097152` exercises a 2 MiB test cap without changing production's 8 MiB limit. X probes also need the existing private FxEmbed key-file setting. An overly tight budget can fail the minimum-quality policy; this is intentional and must not be treated as complete delivery. The existing X video example is 141.109 seconds long and correctly fails the quality floor at 256/512 KiB.

The shared-worker continuation passed **345 application tests (one optional database skip)** and **20 offline Python tests**. Real X delivery with the diagnostic 2 MiB cap produced a complete **1,845,374-byte compressed MP4** at **2026-09-14 00:18:22 UTC**, including full-duration audio/video checks. The real quote regression at the normal cap produced **two original MP4s totalling 1,348,582 bytes**, two cards, and no omissions. Synthetic tests additionally exercise compression of both parent and quote, same media IDs in distinct posts, reduced remaining budgets, failure-driven source retention and a single notice per affected card. Live Discord playback still requires owner testing.
