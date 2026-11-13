#!/usr/bin/env bash
# Installs the desktop apps bots use on their computers, and JuiceFS for their files (D-20),
# into .tools/ without root. Versions are pinned and every download is checked against the
# project's published SHA-256 sums. Run it on every machine image. Each tool is installed once per
# version into the tools' store and linked into .tools/ (scripts/tools-store.sh, D-70), so a
# tool already in the store at its pinned version is reused and only a missing or changed one is
# installed.
#
#   .tools/bin/juicefs                  JuiceFS client (bots' shared, disposable-safe files)
#   .tools/bin/rclone                   mounts a person's own storage as a folder
#   .tools/fuse/fusermount3             how rclone mounts in Mercbot's namespace (host_fuse_tools)
#   .tools/piper/                       Piper text-to-speech and one English voice, for voice memos
#   .tools/apps/<app>/bin/<app>[-cli]   ArtCraft apps: WordCraft, GridCraft, DeckCraft, PdfCraft
#   .tools/coding/node_modules/.bin/    Claude Code and Codex CLI, which people sign in to with their
#                                       own accounts on their bots' computers (the coding hand-off)
#   .tools/desktop/                     the desktops' host programs when the system has none, obtained
#                                       the host's way (host_desktop_tools in the hosting script)
#   .tools/bin/runsc                    gVisor, the sandbox bots' commands run in (D-47)
#   .tools/toolbox/rootfs               the Ubuntu toolbox those commands see (scripts/build-toolbox.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$ROOT/.tools"
# The hosting script (HOSTING_SCRIPT, D-68) checks first that this host gives Mercbot what it needs,
# so a host that doesn't stops here, saying why, before anything is downloaded.
bash "$ROOT/scripts/namespace.sh" --check
# What the install does the host's way comes from it too.
# shellcheck source=hosting/vibe64.sh
. "$ROOT/${HOSTING_SCRIPT:-scripts/hosting/vibe64.sh}"
# shellcheck source=tools-store.sh
. "$ROOT/scripts/tools-store.sh"
DOWNLOADS="$STORE/downloads"
mkdir -p "$TOOLS" "$DOWNLOADS"
# One install at a time per store.
exec 9>"$STORE/.lock"
flock 9
# A checkout's downloads from before the store.
rm -rf "$TOOLS/downloads"

# Raised when an install step below changes, so stores install those tools again.
REVISION=1
JUICEFS_VERSION="1.4.2"
GVISOR_RELEASE="release-20261026.0"
RCLONE_VERSION="1.75.2"
APPS=(
  "wordcraft 0.10.0"
  "gridcraft 0.11.1"
  "deckcraft 0.10.0"
  "pdfcraft 0.13.0"
)
# What the host's way gives depends on the hosting script and the system's release.
HOST_KEY="$( { cat "$ROOT/${HOSTING_SCRIPT:-scripts/hosting/vibe64.sh}" "$ROOT"/scripts/hosting/lib/*.sh; cat /etc/os-release 2>/dev/null || true; } | sha256sum | cut -c1-12)"

fetch() { # url sums-url name
  local url="$1" sums="$2" name="$3"
  if [ ! -f "$DOWNLOADS/$name" ]; then
    curl -fsSL --retry 3 -o "$DOWNLOADS/$name.part" "$url"
    mv "$DOWNLOADS/$name.part" "$DOWNLOADS/$name"
  fi
  curl -fsSL --retry 3 -o "$DOWNLOADS/$name.sums" "$sums"
  # One that doesn't match its sum goes, so the next run downloads it again.
  (cd "$DOWNLOADS" && grep " \*\?$name\$" "$name.sums" | sed 's/ \*/  /' | sha256sum -c --quiet -) || { rm -f "$DOWNLOADS/$name"; return 1; }
}

# JuiceFS
install_juicefs() { # dir
  local name="juicefs-$JUICEFS_VERSION-linux-amd64.tar.gz"
  local base="https://github.com/juicedata/juicefs/releases/download/v$JUICEFS_VERSION"
  fetch "$base/$name" "$base/checksums.txt" "$name"
  mkdir -p "$1/bin"
  tar -xzf "$DOWNLOADS/$name" -C "$1/bin" juicefs
  echo "JuiceFS $JUICEFS_VERSION installed"
}
tools_install juicefs "$JUICEFS_VERSION-r$REVISION" install_juicefs bin/juicefs

# rclone mounts a person's own storage (WebDAV, Nextcloud, Google Drive) as a folder (D-26)
install_rclone() { # dir
  local name="rclone-v$RCLONE_VERSION-linux-amd64.deb"
  local base="https://github.com/rclone/rclone/releases/download/v$RCLONE_VERSION"
  fetch "$base/$name" "$base/SHA256SUMS" "$name"
  host_unpack_deb "$DOWNLOADS/$name" "$1/package"
  mkdir -p "$1/bin"
  cp "$1/package/usr/bin/rclone" "$1/bin/rclone"
  rm -rf "$1/package"
  echo "rclone $RCLONE_VERSION installed"
}
tools_install rclone "$RCLONE_VERSION-r$REVISION" install_rclone bin/rclone

# rclone mounts in Mercbot's own namespace through this, the host's way (D-68).
install_fuse() { # dir
  host_fuse_tools "$1" "$DOWNLOADS"
}
tools_install fuse "$HOST_KEY-r$REVISION" install_fuse fuse

# Piper speaks bots' voice memos on the server, with one English voice. Both are
# MIT-licensed and pinned by checksum.
PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
PIPER_SHA="a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992"
VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alba/medium/en_GB-alba-medium"
VOICE_SHA="401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b"
VOICE_JSON_SHA="aa965a2f02ecced632c2694e1fc72bbff6d65f265fab567ca945918c73dd89f4"
install_piper() { # dir
  curl -fsSL --retry 3 -o "$DOWNLOADS/piper_linux_x86_64.tar.gz" "$PIPER_URL"
  curl -fsSL --retry 3 -o "$DOWNLOADS/piper-voice.onnx" "$VOICE_BASE.onnx"
  curl -fsSL --retry 3 -o "$DOWNLOADS/piper-voice.onnx.json" "$VOICE_BASE.onnx.json"
  (cd "$DOWNLOADS" && printf '%s  %s\n%s  %s\n%s  %s\n' "$PIPER_SHA" piper_linux_x86_64.tar.gz "$VOICE_SHA" piper-voice.onnx "$VOICE_JSON_SHA" piper-voice.onnx.json | sha256sum -c --quiet -)
  tar -xzf "$DOWNLOADS/piper_linux_x86_64.tar.gz" -C "$1"
  cp "$DOWNLOADS/piper-voice.onnx" "$1/piper/voice.onnx"
  cp "$DOWNLOADS/piper-voice.onnx.json" "$1/piper/voice.onnx.json"
  echo "Piper and its voice installed"
}
tools_install piper "$(echo "$PIPER_SHA $VOICE_SHA $VOICE_JSON_SHA" | sha256sum | cut -c1-12)-r$REVISION" install_piper piper

# ArtCraft apps (the tarballs carry both the app and its -cli, which serves MCP)
install_app() { # dir; the loop below sets app and version
  local name="$app-$version-linux-x86_64.tar.gz"
  local base="https://github.com/storytold/$app/releases/download/v$version"
  fetch "$base/$name" "$base/SHA256SUMS.txt" "$name"
  mkdir -p "$1/apps/$app"
  tar -xzf "$DOWNLOADS/$name" -C "$1/apps/$app" --strip-components=1
  if [ "$app" = "pdfcraft" ] && [ ! -x "$1/apps/$app/bin/pdfcraft-cli" ]; then
    local cli="pdfcraft-cli-$version-linux-x86_64.tar.gz"
    fetch "$base/$cli" "$base/SHA256SUMS.txt" "$cli"
    tar -xzf "$DOWNLOADS/$cli" -C "$1/apps/$app" --strip-components=1
  fi
  echo "$version" > "$1/apps/$app/VERSION"
  echo "$app $version installed"
}
for entry in "${APPS[@]}"; do
  read -r app version <<<"$entry"
  tools_install "$app" "$version-r$REVISION" install_app "apps/$app"
done

# Claude Code and Codex CLI for bots' computers (the coding hand-off), each signed in there with
# the person's own account. Pinned in scripts/coding-tools, with npm's integrity check of every
# package in its lock; the computers' gVisor sandboxes see them read-only as /opt/coding.
install_coding() { # dir
  mkdir -p "$1/coding"
  cp "$ROOT/scripts/coding-tools/package.json" "$ROOT/scripts/coding-tools/package-lock.json" "$1/coding/"
  (cd "$1/coding" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
  echo "Coding tools installed"
}
tools_install coding "$(sha256sum < "$ROOT/scripts/coding-tools/package-lock.json" | cut -c1-12)-r$REVISION" install_coding coding

# The bots' desktops' own programs on the host, the host's way (D-68), which depend on what the
# system has.
install_desktop() { # dir
  host_desktop_tools "$1" "$DOWNLOADS"
}
tools_install desktop "$(echo "$HOST_KEY $(command -v tint2 hsetroot xterm || true)" | sha256sum | cut -c1-12)-r$REVISION" install_desktop desktop

# gVisor runs bots' commands with its own kernel, rootless and without network (D-47)
install_gvisor() { # dir
  local name="gvisor-x86_64.tar.bz2"
  local base="https://github.com/google/gvisor/releases/download/$GVISOR_RELEASE"
  rm -f "$DOWNLOADS/$name"
  fetch "$base/$name" "$base/SHA256SUMS" "$name"
  mkdir -p "$1/bin"
  tar -xjf "$DOWNLOADS/$name" -C "$1/bin" runsc gvisor-bin
  echo "gVisor $GVISOR_RELEASE installed"
}
tools_install gvisor "$GVISOR_RELEASE-r$REVISION" install_gvisor bin/runsc bin/gvisor-bin
# Without the lock's descriptor: this script holds the lock, and gVisor gets only what it needs.
bash "$ROOT/scripts/build-toolbox.sh" 9>&-

# The store keeps only what's installed.
rm -rf "$DOWNLOADS"
echo "Tools ready in $TOOLS"
