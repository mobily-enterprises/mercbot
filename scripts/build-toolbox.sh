#!/usr/bin/env bash
# Builds the toolbox bots' commands run in (D-47): an Ubuntu 24.04 system with the tools below,
# used read-only by gVisor. No root is needed: Ubuntu's base image is checked against its
# published sums, the hosting script (HOSTING_SCRIPT, D-68) obtains the packages,
# and they are installed inside gVisor without network. It is built in the tools' store
# (scripts/tools-store.sh, D-70) and linked into .tools, and skipped when the store's toolbox
# already has this package list: its stamp, written last before the finished folder replaces the
# old one, marks it complete, so a build cut short is started again, never used.
#
#   .tools/toolbox/rootfs     the toolbox (stamp in etc/mercbot-toolbox)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/.tools"
# shellcheck source=tools-store.sh
. "$ROOT/scripts/tools-store.sh"
# shellcheck source=toolbox-run.sh
. "$ROOT/scripts/toolbox-run.sh"
BOX="$STORE/toolbox"
RUNSC="$TOOLS/bin/runsc"

BASE_RELEASE="https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release"
BASE="ubuntu-base-24.04.5-base-amd64.tar.gz"
PACKAGES=(
  bash coreutils findutils grep sed gawk bc file less tree
  zip unzip p7zip-full xz-utils bzip2 zstd
  jq sqlite3 ripgrep git libatomic1 tmux libutempter0
  ffmpeg imagemagick libheif1 webp
  poppler-utils ghostscript qpdf
  tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra tesseract-ocr-deu tesseract-ocr-ita tesseract-ocr-spa tesseract-ocr-por
  pandoc
  python3 python3-pip python3-venv python3-pandas python3-numpy python3-matplotlib python3-pil
  python3-openpyxl python3-xlsxwriter python3-docx python3-bs4 python3-lxml python3-typing-extensions
  python3-markdown python3-yaml python3-dateutil
  hunspell hunspell-en-gb hunspell-en-us
  fonts-liberation fonts-dejavu fonts-noto-cjk fonts-noto-color-emoji
  ca-certificates
  # Chrome for Testing's libraries, and software graphics for the Craft apps, for computers that
  # run their apps in gVisor (D-47)
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libcurl4t64
  libdbus-1-3 libexpat1 libgbm1 libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 libudev1
  libvulkan1 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2
  libxkbcommon-x11-0 libxcb-xkb1 mesa-vulkan-drivers libegl1 libegl-mesa0 libgl1
)
# Python packages Ubuntu doesn't carry, as pinned wheels checked against PyPI's sums
WHEELS=(
  "https://files.pythonhosted.org/packages/d9/4f/00be2196329ebbff56ce564aa94efb0fbc828d00de250b1980de1a34ab49/python_pptx-1.0.2-py3-none-any.whl 160838e0b8565a8b1f67947675886e9fea18aa5e795db7ae531606d68e785cba"
)

# Node.js (LTS, the same major version Mercbot runs on) with npm, from nodejs.org, checked
# against its pinned sum. Ubuntu's own is too old for current projects.
NODE="https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997"
# Chrome for Testing, Google's pinned build for automation, in /opt/chrome (its sum taken when it
# was pinned; Google doesn't publish one).
CHROME="https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.80/linux64/chrome-linux64.zip b711c720f774be355197f32edf37e0651418ba036d92446ee2da19ac017540a7"
# Raised when the install steps below change, so machines rebuild their toolbox.
REVISION=6
# Sorted bytewise (LC_ALL=C): the same list gets the same stamp whatever the locale, so a toolbox built from a terminal
# (en_US.UTF-8, say) isn't built again by a Prepare or service without one (C), nor the other way round.
STAMP="$BASE r$REVISION $(printf '%s\n' "${PACKAGES[@]}" "${WHEELS[@]}" "$NODE" "$CHROME" | LC_ALL=C sort | sha256sum | cut -c1-16)"
# What depends on the host, how the packages are obtained among it, comes from the hosting script
# (HOSTING_SCRIPT, D-68), which checks the host first: the toolbox is built inside gVisor, so a host
# that refuses Mercbot its own sandboxes stops here, saying why.
bash "$ROOT/scripts/namespace.sh" --check
# shellcheck source=hosting/vibe64.sh
. "$ROOT/${HOSTING_SCRIPT:-scripts/hosting/vibe64.sh}"
# The host may name its own copy of gVisor (MERCBOT_RUNSC: on a person's own computer, the installer's trusted one).
host_check
RUNSC="${MERCBOT_RUNSC:-$RUNSC}"
stamp() { cat "$1/etc/mercbot-toolbox" 2>/dev/null || true; }
# A checkout's toolbox from before the store moves into it rather than being built again.
if [ "$(stamp "$BOX/rootfs")" != "$STAMP" ] && [ "$(stamp "$TOOLS/toolbox/rootfs")" = "$STAMP" ]; then
  rm -rf "$BOX/rootfs" && mkdir -p "$BOX" && mv "$TOOLS/toolbox/rootfs" "$BOX/rootfs"
fi
# .tools/toolbox holds only the toolbox's links (a checkout's downloads and build folders from
# before the store go).
use_toolbox() {
  tools_link "$BOX/rootfs" "$TOOLS/toolbox/rootfs"
  find "$TOOLS/toolbox" -mindepth 1 -maxdepth 1 ! -name rootfs -exec rm -rf {} +
}
if [ "$(stamp "$BOX/rootfs")" = "$STAMP" ]; then use_toolbox; exit 0; fi
if [ ! -x "$RUNSC" ]; then echo "The toolbox needs gVisor (.tools/bin/runsc): run scripts/install-tools.sh." >&2; exit 1; fi

mkdir -p "$BOX/downloads"
NEW="$BOX/rootfs.new"
APT="$BOX/apt"
STATE="$BOX/runsc-state"
rm -rf "$NEW" "$APT" "$STATE"
mkdir -p "$NEW" "$STATE"

# Ubuntu's base system, checked against its published sums
curl -fsSL --retry 3 -o "$BOX/downloads/SHA256SUMS" "$BASE_RELEASE/SHA256SUMS"
if [ ! -f "$BOX/downloads/$BASE" ]; then
  curl -fsSL --retry 3 -o "$BOX/downloads/$BASE.part" "$BASE_RELEASE/$BASE"
  mv "$BOX/downloads/$BASE.part" "$BOX/downloads/$BASE"
fi
# A download that doesn't match its sum goes, so the store never keeps it for the next build.
(cd "$BOX/downloads" && grep " \*\?$BASE\$" SHA256SUMS | sed 's/ \*/  /' | sha256sum -c --quiet -) || { rm -f "$BOX/downloads/$BASE"; exit 1; }
tar -xzf "$BOX/downloads/$BASE" -C "$NEW" --exclude='./dev/*'
# Package scripts copy files keeping their permissions, which fails on inherited access lists
# (gVisor can't set them), so the toolbox folder has none.
if command -v setfacl >/dev/null 2>&1; then setfacl -R -b -k "$NEW"; fi

# The packages, obtained the host's way, into $NEW/debs
host_toolbox_packages "$APT" "$NEW" "${PACKAGES[@]}"
node_file="$BOX/downloads/$(basename "${NODE% *}")"
[ -f "$node_file" ] || curl -fsSL --retry 3 -o "$node_file" "${NODE% *}"
echo "${NODE#* }  $node_file" | sha256sum -c --quiet - || { rm -f "$node_file"; exit 1; }
tar -xJf "$node_file" -C "$NEW/usr/local" --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE'
chrome_file="$BOX/downloads/chrome-linux64-$(basename "$(dirname "$(dirname "${CHROME% *}")")").zip"
[ -f "$chrome_file" ] || curl -fsSL --retry 3 -o "$chrome_file" "${CHROME% *}"
echo "${CHROME#* }  $chrome_file" | sha256sum -c --quiet - || { rm -f "$chrome_file"; exit 1; }
# Unpacked inside the sandbox below, by its own unzip, so the host needs no unzip or Python.
cp "$chrome_file" "$NEW/chrome.zip"
mkdir -p "$NEW/wheels"
for wheel in "${WHEELS[@]}"; do
  url="${wheel% *}" sum="${wheel#* }" file="$BOX/downloads/$(basename "${wheel% *}")"
  [ -f "$file" ] || curl -fsSL --retry 3 -o "$file" "$url"
  echo "$sum  $file" | sha256sum -c --quiet - || { rm -f "$file"; exit 1; }
  cp "$file" "$NEW/wheels/"
done

# Installed inside gVisor, without network, as the root of its own user namespace
cat > "$BOX/install.sh" <<'EOF'
set -e
# The sandbox started: a failure from here on is the install's own (scripts/toolbox-run.sh).
: > /install.started
export DEBIAN_FRONTEND=noninteractive
# Only root is mapped here, so setting other owners fails; package scripts that do it (dbus's
# dpkg-statoverride) carry on as if it worked, and files simply stay root's.
mv /usr/bin/dpkg-statoverride /usr/bin/dpkg-statoverride.real
printf '#!/bin/sh\n/usr/bin/dpkg-statoverride.real "$@" 2>/dev/null || true\n' > /usr/bin/dpkg-statoverride
chmod 755 /usr/bin/dpkg-statoverride
dpkg -i --force-depends /debs/*.deb >/tmp/dpkg.log 2>&1 || true
dpkg --configure -a >>/tmp/dpkg.log 2>&1 || { tail -20 /tmp/dpkg.log; exit 1; }
mv /usr/bin/dpkg-statoverride.real /usr/bin/dpkg-statoverride
# A package whose files belong to another user or group (libutempter0: group utmp) can't be
# unpacked here, where only root is mapped: its files are extracted as root's instead.
for deb in /debs/*.deb; do
  package="$(dpkg-deb -f "$deb" Package)"
  dpkg -s "$package" 2>/dev/null | grep -q '^Status: install ok installed' || { echo "extracted: $package"; dpkg-deb -x "$deb" / 2>/dev/null || true; }
done
unzip -q /chrome.zip -d /opt
rm -rf /opt/chrome && mv /opt/chrome-linux64 /opt/chrome && rm /chrome.zip
python3 -m pip install --no-index --no-deps --break-system-packages --root-user-action=ignore -q /wheels/*.whl
# Ubuntu's ImageMagick refuses PDFs, PostScript and text from files, against untrusted input on a
# server. Here the whole toolbox is the sandbox, so bots may use them; resource limits stay.
sed -i -E '/pattern="(PS|PS2|PS3|EPS|PDF|XPS|@\*)"/d' /etc/ImageMagick-6/policy.xml
EOF
cp "$BOX/install.sh" "$NEW/install.sh"
cat > "$BOX/config.json" <<EOF
{
  "ociVersion": "1.0.0",
  "process": { "user": { "uid": 0, "gid": 0 }, "args": ["/bin/sh", "/install.sh"], "env": ["PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C.UTF-8"], "cwd": "/" },
  "root": { "path": "$NEW", "readonly": false },
  "hostname": "toolbox",
  "mounts": [
    { "destination": "/proc", "type": "proc", "source": "proc" },
    { "destination": "/dev", "type": "tmpfs", "source": "tmpfs" },
    { "destination": "/tmp", "type": "tmpfs", "source": "tmpfs" }
  ],
  "linux": { "namespaces": [{ "type": "pid" }, { "type": "ipc" }, { "type": "uts" }, { "type": "mount" }, { "type": "network" }] }
}
EOF
toolbox_run "$RUNSC" "$STATE" "$BOX" "$NEW"

missing="$(for package in "${PACKAGES[@]}"; do grep -q "^Package: $package\$" "$NEW/var/lib/dpkg/status" || echo "$package"; done)"
if [ ! -e "$NEW/usr/bin/tmux" ] || [ -z "$(ls "$NEW"/usr/lib/x86_64-linux-gnu/libutempter.so.* 2>/dev/null)" ]; then missing="$missing tmux"; fi
if [ -n "$missing" ]; then echo "The toolbox is missing: $missing" >&2; exit 1; fi
rm -rf "$NEW/debs" "$NEW/wheels" "$NEW/install.sh" "$NEW/chrome.zip" "$NEW"/var/cache/apt/archives/*.deb "$NEW"/var/lib/apt/lists/* "$APT" "$STATE" "$BOX/config.json" "$BOX/install.sh"
echo "$STAMP" > "$NEW/etc/mercbot-toolbox"
rm -rf "$BOX/rootfs.old"
if [ -d "$BOX/rootfs" ]; then mv "$BOX/rootfs" "$BOX/rootfs.old"; fi
mv "$NEW" "$BOX/rootfs"
# The store keeps only the toolbox in use; a running release keeps its own links to an older one.
rm -rf "$BOX/rootfs.old" "$BOX/downloads"
use_toolbox
echo "Toolbox built ($(du -sh "$BOX/rootfs" | cut -f1))"
