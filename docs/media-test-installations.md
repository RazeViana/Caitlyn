# Local media-test installation inventory

Recorded on 2026-09-10. These are the existing tools and cached image packages, not new installations for the X-handler continuation. The continuation reuses the installed dependency layers and rebuilds source code only. Supporting documentation belongs here, separate from the runtime.

## Mac installations from the earlier local-test setup

- Colima 0.10.3: `/opt/homebrew/Cellar/colima/0.10.3`.
- Docker CLI 29.8.0: `/opt/homebrew/Cellar/docker/29.8.0`.
- Lima 2.2.0 (Colima dependency): `/opt/homebrew/Cellar/lima/2.2.0`.

The dedicated VM/profile is `caitlyn-media-test`, with its Docker control socket at `/Users/raze/.colima/caitlyn-media-test/docker.sock`. No Mac-wide FFmpeg, yt-dlp, or Python installation was made for this feature. No autostart service was enabled. See [local media testing](local-media-testing.md) for resource limits and lifecycle.

## Container-only runtime

Image tag: `caitlyn-media-probe:local` in Docker context `colima-caitlyn-media-test`. Package inventory also applies to the original checkpoint image `sha256:0961fb550e3875a56defdca3e0e3c5ec40c62bc29b5ed3c1c52556dc0f3fa995`; X changes reuse its dependency layers.

- Node 24.21.0: `/usr/local/bin/node`.
- npm 11.19.0 (base-image dependency): `/usr/local/lib/node_modules/npm`.
- Yarn 1.22.22 (base-image dependency): `/opt/yarn-v1.22.22`.
- Python 3.14.7: `/usr/bin/python3`; isolated environment `/opt/extractor`.
- Environment pip 26.2.1: `/opt/extractor/lib/python3.14/site-packages`.
- yt-dlp 2026.8.19: `/opt/extractor/bin/yt-dlp` and `/opt/extractor/lib/python3.14/site-packages`.
- FFmpeg/ffprobe 8.1.2: `/usr/bin/ffmpeg` and `/usr/bin/ffprobe`.

The Alpine package database below includes all installed OS/base packages and transitive media dependencies, not just the three explicitly requested packages (`python3`, `py3-pip`, `ffmpeg`). Package files live within the image's `/usr`, `/lib`, `/etc`, and other standard container directories—not equivalent paths on the Mac. Alpine's system pip package and the virtual environment's pip have different versions.

## Complete Alpine package inventory (135 packages)

```text
alpine-baselayout-3.7.2-r1
alpine-baselayout-data-3.7.2-r1
alpine-keys-2.6-r0
alpine-release-3.24.1-r0
alsa-lib-1.2.15.3-r0
aom-libs-3.14.1-r0
apk-tools-3.0.6-r0
brotli-libs-1.2.0-r1
busybox-1.37.0-r31
busybox-binsh-1.37.0-r31
ca-certificates-bundle-20260611-r0
cjson-1.7.19-r1
dbus-libs-1.16.2-r2
ffmpeg-8.1.2-r0
ffmpeg-libavcodec-8.1.2-r0
ffmpeg-libavdevice-8.1.2-r0
ffmpeg-libavfilter-8.1.2-r0
ffmpeg-libavformat-8.1.2-r0
ffmpeg-libavutil-8.1.2-r0
ffmpeg-libswresample-8.1.2-r0
ffmpeg-libswscale-8.1.2-r0
fontconfig-2.17.1-r1
freetype-2.14.3-r0
fribidi-1.0.16-r3
gdbm-1.26-r0
glib-2.88.1-r1
glslang-libs-1.4.341.0-r0
graphite2-1.3.14-r6
harfbuzz-13.2.1-r0
hwdata-pci-0.408-r0
json-c-0.18-r1
lame-libs-3.100-r5
lcms2-2.19-r0
libSvtAv1Enc-4.1.0-r0
libapk-3.0.6-r0
libass-0.17.4-r1
libasyncns-0.8-r5
libblkid-2.42.3-r1
libbluray-1.4.0-r0
libbsd-0.12.2-r0
libbz2-1.0.8-r6
libcrypto3-3.5.7-r0
libdav1d-1.5.3-r0
libdovi-3.3.2-r0
libdrm-2.4.134-r0
libdvdcss-1.4.3-r0
libdvdnav-6.1.1-r1
libdvdread-6.1.3-r2
libeconf-0.8.3-r0
libexpat-2.8.4-r0
libffi-3.5.2-r1
libflac-1.4.3-r2
libgcc-15.2.0-r5
libgomp-15.2.0-r5
libhwy-1.3.0-r0
libintl-1.0-r0
libjpeg-turbo-3.1.3-r0
libjxl-0.11.2-r1
libltdl-2.6.0-r1
libmd-1.2.0-r0
libmount-2.42.3-r1
libncursesw-6.6_p20260516-r0
libogg-1.3.6-r0
libopenmpt-0.8.9-r0
libpanelw-6.6_p20260516-r0
libpciaccess-0.19-r0
libplacebo-7.360.1-r0
libpng-1.6.58-r1
libpulse-17.0-r7
librist-0.2.15-r0
libsharpyuv-1.6.0-r0
libsndfile-1.2.2-r2
libsodium-1.0.22-r0
libsrt-1.5.3-r1
libssh-0.12.2-r0
libssl3-3.5.7-r0
libstdc++-15.2.0-r5
libtheora-1.2.0-r1
libudfread-1.2.0-r1
libunibreak-6.1-r0
libva-2.23.0-r0
libvdpau-1.5-r4
libvorbis-1.3.7-r2
libvpx-1.15.2-r1
libwebp-1.6.0-r0
libwebpmux-1.6.0-r0
libx11-1.8.13-r0
libxau-1.0.12-r0
libxcb-1.17.0-r2
libxdmcp-1.1.5-r1
libxext-1.3.7-r0
libxfixes-6.0.2-r0
libxml2-2.13.9-r2
libzmq-4.3.5-r2
lilv-libs-0.24.26-r1
mbedtls3-3.6.7-r0
mpdecimal-4.0.1-r0
mpg123-libs-1.33.5-r0
musl-1.2.6-r2
musl-utils-1.2.6-r2
ncurses-terminfo-base-6.6_p20260516-r0
numactl-2.0.19-r0
opus-1.6.1-r0
orc-0.4.41-r0
pcre2-10.48-r0
py3-pip-26.1.2-r0
py3-pip-pyc-26.1.2-r0
pyc-3.14.7-r1
python3-3.14.7-r1
python3-pyc-3.14.7-r1
python3-pycache-pyc0-3.14.7-r1
rav1e-libs-0.8.1-r0
readline-8.3.3-r1
scanelf-1.3.9-r1
serd-libs-0.32.8-r0
shaderc-2026.1-r0
sord-libs-0.16.22-r0
soxr-0.1.3-r7
speexdsp-1.2.1-r2
spirv-tools-1.4.341.0-r0
sqlite-libs-3.53.4-r0
sratom-0.6.20-r0
ssl_client-1.37.0-r31
tdb-libs-1.4.15-r1
v4l-utils-libs-1.32.0-r1
vidstab-1.1.1-r0
vulkan-loader-1.4.347-r0
wayland-libs-client-1.25.0-r0
x264-libs-0.164.3108-r1
x265-libs-4.1-r0
xvidcore-1.3.7-r2
xz-libs-5.8.4-r0
zimg-3.0.6-r0
zix-libs-0.8.0-r0
zlib-1.3.2-r0
```

Inventory was read without network access using `apk info -v`, Python/pip version checks, and Node/npm/Yarn version checks. This is an observed installation inventory, not a package-lock or vulnerability audit. Rebuilding dependency layers in the future must record any version changes and list exactly what was installed.
