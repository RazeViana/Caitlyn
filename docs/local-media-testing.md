# Local isolated media tests

Verified on 2026-09-10, on this Apple Silicon Mac. This is a disposable feasibility harness, **not the bot's production media worker**. It never logs into Discord or accesses the application database. The baseline is committed as `03eab46`; the X whole-post continuation is uncommitted. See [replacement progress](social-media-replacement.md#x-adapter-and-renderer-continuation) for the latest X results and remaining feature work.

## Installed locally

Homebrew installed Colima 0.10.3, Docker CLI 29.8.0, and Colima's Lima 2.2.0 dependency. Created only the named `caitlyn-media-test` Colima profile: two CPUs, 3 GiB RAM, a 12 GiB sparse data disk, and the runtime's default 20 GiB sparse OS disk. Sparse capacity is not the same as disk space consumed. No login/startup service was enabled. The default Docker context remains `default`.

The profile disables Mac directory mounts, SSH-agent forwarding, SSH-config generation, and application port forwarding. The local control socket is used by the host harness only, never mounted in a media container. The homeserver was not contacted or changed.

The image contains Node 24.21.0, Python 3.14.7, yt-dlp 2026.08.19, and FFmpeg/ffprobe 8.1.2. The Node image is pinned by digest and the extractor wheel by version and SHA-256. Exact locations and all 135 Alpine packages are listed in [the installation inventory](media-test-installations.md). No new packages were installed for the X continuation; image inspection confirmed identical dependency layers. Alpine packages are not independently locked to repository snapshots, so this is not a bit-for-bit reproducible production image. Last tested image ID: `sha256:6152cf3f6d96772316f7f8d61118ba614ebeee540860708a9eeda2f48831ec3e`.

The harness stages a temporary build directory containing only the explicitly named Dockerfile/ignore file, requirements, gateway/worker sources, X Python bridge, and shared X normalizer. The shared file is copied from `core/`, not maintained as a duplicate. The repository root, `.env`, backups, and `node_modules` never enter the context. The temporary directory is removed in `finally`. Invoke the harness to build; a direct build of `scripts/mediaSandbox/` alone lacks the shared normalizer. No Python/FFmpeg/extractor installation was made on the Mac itself; those tools live in the container image.

## Isolation and limits

- Each case gets a fresh non-root worker using Docker `--network=none`, read-only root filesystem, all capabilities dropped, no-new-privileges, no credentials, and no host-directory or Docker-socket mounts.
- The only shared mount is a temporary IPC volume, read-only in the worker. A loopback relay inside the worker connects to a Unix socket in that volume. It cannot access the Mac's localhost services.
- A separate gateway permits CONNECT requests only to known X/TikTok/Instagram/CDN hosts on port 443. Other hosts, ports, IP literals, and Reddit are rejected. Public IPv4 DNS answers are checked before connecting to the resulting IP literal; mixed public/private answers fail closed. IPv6 is deliberately unsupported. Private, loopback, link-local, CGNAT/Tailscale, documentation, and other special-use IPv4 ranges are denied.
- Gateway limits: eight concurrent tunnels, 20 seconds per tunnel, 128 MiB total transferred data per case, 96 MiB RAM, 0.25 CPU, 32 processes, and a 110-second process lifetime. It listens only on the Unix socket and exposes no host port.
- Worker limits: 512 MiB RAM with no additional swap allowance, one CPU, 64 processes, and 96 MiB temporary RAM-backed storage. yt-dlp has an eight-second socket timeout, no retries, and a 55-second process deadline. A 75-second container command deadline and 85-second host timeout bound the whole case. Temporary logs are capped at two 64 KiB files per container.
- Download selection requests MP4 video/audio, preferring separate compatible streams when available, with a lower-quality muxed fallback. yt-dlp's 32 MiB limit applies per download stream; temporary storage and gateway caps remain hard bounds when metadata is missing or inaccurate. Final files over 32 MiB are not accepted for decode validation. This is a test budget, **not a claim about Discord's upload limit**.
- The final duration limit is 15 minutes, with missing metadata allowed only so the downloaded file can be inspected by ffprobe. Files with unknown/invalid/over-limit actual duration are not accepted. FFmpeg decodes only the first two seconds, with network protocols disabled and an eight-second deadline. This does not validate every frame or Discord playback.

Every live case first passed checks for unprivileged execution, absence of credentials and host mounts, inability to connect directly to public/private/host IPs, and gateway rejection of private/loopback targets, Reddit, and non-HTTPS ports. Four offline tests exercise host validation, blocked address ranges, mixed DNS answers, and stable error categories. These checks validate this harness configuration, not a general claim that containers eliminate every security risk.

`--x-post` uses a separate raw-GraphQL bridge and bounded original-media downloader inside the same isolation boundary. Metadata is capped at 1 MiB of serialized output; Python memory and all network traffic remain bounded by container/gateway limits while parsing. Each metadata subprocess has 25 seconds; each download 12 seconds. Images allow 12 MiB and 40 million pixels, exact reported original dimensions, known MIME/codec pairs, and one-frame decode. Videos allow 10 MiB and 15 minutes, H.264 with AAC (audio absence allowed only for GIFs), and a two-second decode. At most four descending video candidates are attempted; only size failures allow fallback. All redirects for direct media downloads are rejected. Authentication/rate-limit failures stop further media for that post. No files or raw provider data leave the worker; the host receives summaries only.

## Results

Baseline video-only run: 12:03–12:04 UTC on 2026-09-10. Its X image/text/quote limitations below are superseded by the [whole-post run at 12:53–12:54 UTC](social-media-replacement.md#x-adapter-and-renderer-continuation); TikTok/Instagram/Reddit status is unchanged. Public examples are linked in [the feasibility table](social-media-replacement.md#live-endpoint-checks).

| Case | Observed result | What remains unproved |
| --- | --- | --- |
| X one image | `no_video_formats` | Original image retrieval |
| X gallery | `no_video_formats` | Complete ordered gallery |
| X text | `no_video_formats` | Complete text extraction/rendering |
| X video | 3,162,626-byte MP4; 480×270 H.264 + AAC; 141.18 s; first two seconds decode | Discord delivery; full-file decode. An earlier higher-quality run also verified 1280×720 at 25,764,042 bytes |
| X quoted post | 116,384-byte MP4; 480×270 H.264 + AAC; 8.68 s; first two seconds decode | Separate parent/quote attribution and complete media collection. Earlier 720p selection was 786,568 bytes |
| TikTok video | Reported 654 s and ten formats; reached the media CDN; stopped at `size_limit` | Full download/audio/playback and oversized-video strategy |
| Instagram example post | 1,512,664-byte MP4; 640×640 H.264; 15.02 s; decode passed; no audio stream | Whether source audio exists/is accessible; image handling |
| Instagram reel | 918,120-byte MP4; 480×854 H.264; 4.97 s; decode passed; no audio stream | Whether source audio exists/is accessible |
| Instagram multi-video post | One 39,880-byte MP4; 640×640 H.264; 4.00 s; decode passed; no audio stream | All items, ordering, audio. Harness deliberately limits playlists to one item |
| Reddit | No extractor/API request; blocked by access gate | Approved access and all media/text behavior |

These are sample results, not guaranteed platform-wide support. Media IDs and source-post IDs can differ. A retrieved quote clip does not establish a correct quoted-post model. A downloaded Instagram file without an audio stream is not evidence that the source must be silent. The harness never posted files to Discord or visually reviewed the source content.

Two setup issues were fixed before successful retrieval: Docker's local log driver needed two retained files with compression enabled, and the pinned yt-dlp version does not accept `--no-netrc` (netrc is opt-in; none is mounted or enabled). Error classification now avoids reading the command line as a provider timeout. The initial three-minute metadata filter also skipped the long TikTok and unknown-duration Instagram items; the bounded final policy above handles these distinctly. TikTok still exceeds the independent size cap and was not retried past that cap.

## Repeat the tests

The test VM was stopped after completion to release CPU/RAM. Installed tools, the named VM, and cached images remain for reuse; all case containers, IPC volumes, and downloaded files were removed. Test files can be downloaded again if still available from their sources.

Start only the dedicated profile:

```bash
colima start caitlyn-media-test --cpu 2 --memory 3 --disk 12 \
  --vm-type vz --mount none --ssh-agent=false --ssh-config=false \
  --activate=false --port-forwarder none
```

From the repository root:

```bash
# All nine cases; no Reddit access.
LOG_LEVEL=DEBUG node --import tsx scripts/testSocialMediaLocal.ts

# Or one named case.
LOG_LEVEL=DEBUG node --import tsx scripts/testSocialMediaLocal.ts x-video

# Whole-post X metadata, original images, and separately attributed budgeted videos.
LOG_LEVEL=DEBUG node --import tsx scripts/testSocialMediaLocal.ts --x-post
LOG_LEVEL=DEBUG node --import tsx scripts/testSocialMediaLocal.ts --x-post x-quote
```

Other names: `x-image`, `x-gallery`, `x-text`, `x-quote`, `tiktok-video`, `instagram-post`, `instagram-reel`, `instagram-multi-video`. This intentionally takes fixture names, not arbitrary URLs, cookie files, credentials, or Docker hosts. New samples need reviewed fixture changes.

The harness checks that its Docker context resolves to the dedicated local Unix socket. It does not start/stop Colima itself. INFO reports setup/isolation; SUCCESS reports files passing the bounded decode; WARN reports gaps/limits; DEBUG reports gateway event categories and allowlisted hostnames. It uses Caitlyn's existing logger but does not start Discord log forwarding. No raw provider errors, response bodies, signed URLs, or media files are written into project logs/documents.

Exit `0` means the harness completed its cases, **not that all platforms succeeded**. Check each outcome. A setup/isolation or cleanup failure exits `1`; cleanup failures are named and no successful-cleanup summary is printed. Normal cleanup removes only the uniquely named containers/volumes created by that invocation. If the host process is killed abruptly, worker/gateway deadlines bound execution but stopped containers or IPC volumes may need manual review; inspect only resources labeled `dev.caitlyn.media-test=true` in this dedicated context. Do not prune unrelated Docker resources.

After testing:

```bash
colima stop caitlyn-media-test
```

`npm run check` passes typechecking, lint, build, and 173 tests with one optional PostgreSQL test skipped. Ordinary tests never launch Docker or retrieve live media. Bot runtime behavior, database, command registration, and homeserver remain unchanged. The baseline is signed as `03eab46`; new X work remains uncommitted. Nothing was merged, pushed, or deployed.

Tool references: [Colima's official setup](https://github.com/abiosoft/colima), [Docker container controls](https://docs.docker.com/engine/containers/run/), and [yt-dlp's upstream project](https://github.com/yt-dlp/yt-dlp). The final production design still needs per-platform adapters, secure worker integration, Discord delivery limits, retention, and authorization review.
