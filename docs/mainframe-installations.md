# Mainframe installation inventory

Deployment date: 2026-09-18. **No packages were installed on macOS or the TrueNAS host.** New packages and downloaded base images are confined to Docker on the mainframe. The existing PostgreSQL 17.8 container/data directory was reused, not upgraded.

[Complete installed package list](mainframe-installations.json) enumerates every observed OS package and npm package with exact versions; npm entries include their installed paths. It also records both Python virtual-environment packages and the exact image IDs. Counts below include dependencies bundled with each base image, not only packages added by the Dockerfile. Packages repeated across images are intentionally listed in each image.

| Image | Main components | Complete inventory entries |
| --- | --- | --- |
| Bot | Node 24.21.0, npm 11.19.0, Yarn 1.22.22; production dependencies from the existing application lockfile | 18 Alpine packages; 187 npm entries (42 application, 145 global) |
| Broker | Bot dependencies plus Docker CLI 29.5.3 and CA certificates 20260909-r0 | 20 Alpine packages; 187 npm entries |
| Media worker | Node 24.21.0, npm 11.19.0, Yarn 1.22.22, Python 3.14.7, FFmpeg 8.1.2, yt-dlp 2026.8.19, virtual-environment pip 26.2.1 | 136 Alpine packages; 145 global npm entries; 2 virtual-environment Python packages |
| FxEmbed | Node 24.19.0, npm 11.17.0, Yarn 1.22.22; vendored FxEmbed dependencies from its existing lockfile | 88 Debian packages; 583 npm entries (438 application/workspace, 145 global) |
| Build stage only | Node 24.21.0, npm 11.19.0, Yarn 1.22.22; application build/test dependencies from the existing lockfile | 18 Alpine packages; 289 npm entries (144 application/build, 145 global) |

The media image's system `py3-pip` package is 26.1.2-r0; its separate extractor environment uses pip 26.2.1. Extractor packages live under `/opt/extractor/lib/python3.14/site-packages`. OS package entries record the distribution package revision as well as its version. The broker's Docker CLI does not replace the host's Docker Engine 28.3.1.

Base images downloaded to the mainframe:

- `node:24-alpine@sha256:83f1c388c31fb2e51f7cbd4dea949b96260798c98f206e8e4696bc93bd964e3a`
- `node:24.19.0-bookworm-slim@sha256:e5a8dee7bc1e6a215d224a7ef8206f7e77271bc3cabd5febf2beafac0674f174`

Application source: published `bcde78a7f664900ddaec4d1c6ad8259cb2d7fa3c` plus reviewed deployment overlays. FxEmbed source: `5b5b6207d9fd93bae15a68ab659fbc97cdbf61b5`. No project/vendor lockfile was changed. The build-stage inventory was collected from the same cached lockfile installation used by the final release. Earlier failed image candidates contain subsets of these same packages; their tags/build caches were retained, not globally pruned.

Inventories were collected inside non-networked, read-only disposable containers using `scripts/deployment/imageInventory.mjs`. They contain no environment values, credentials, post content or database records.
