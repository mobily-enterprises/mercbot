# What Mercbot's hosting scripts on Ubuntu and Debian share (D-68): scripts/hosting/vibe64.sh and
# scripts/hosting/local.sh source it and add their own host_check and host_display_programs.
# It is not a hosting script itself, so HOSTING_SCRIPT never names it.

host_refuse() { # sentence, the error underneath
  printf '%s See README → Hosting requirements.\n%s\n' "$1" "$2" >&2
  exit 1
}

# Exports MERCBOT_XVFB, MERCBOT_X11VNC and MERCBOT_OPENBOX, the programs bots' computers run
# (computerManager.js, desktop.js), or stops with SENTENCE, naming each one missing.
host_find_display_programs() { # sentence
  local xvfb x11vnc openbox
  xvfb="$(command -v Xvfb || true)"
  x11vnc="$(command -v x11vnc || true)"
  openbox="$(command -v openbox || true)"
  if [ -z "$xvfb" ] || [ -z "$x11vnc" ] || [ -z "$openbox" ]; then
    host_refuse "$1" "Xvfb: ${xvfb:-not found}; x11vnc: ${x11vnc:-not found}; openbox: ${openbox:-not found} (PATH=$PATH)"
  fi
  export MERCBOT_XVFB="$xvfb" MERCBOT_X11VNC="$x11vnc" MERCBOT_OPENBOX="$openbox"
  # Xvfb draws with Mesa's software EGL. Vibe64's application sandbox hides every GPU (PrivateDevices),
  # where a GPU driver's own EGL library, which glvnd would pick first, can't work (NVIDIA's crashes
  # Xvfb as it starts); on a person's computer bots' screens gain nothing from the GPU either.
  if [ -f /usr/share/glvnd/egl_vendor.d/50_mesa.json ]; then
    export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json
  fi
}

# The toolbox's Ubuntu packages (the arguments after the two folders), downloaded by the host's
# apt into the private folder APT with the toolbox's own sources, keyring and installed list from
# ROOTFS, so only what's missing comes down. Leaves the .deb files in ROOTFS/debs, which
# scripts/build-toolbox.sh installs inside gVisor without network.
host_toolbox_packages() {
  local apt="$1" rootfs="$2"
  shift 2
  command -v apt-get >/dev/null 2>&1 ||
    host_refuse "This host has no apt-get, which building Mercbot's toolbox needs here." "apt-get: not found"
  mkdir -p "$apt/etc/apt/sources.list.d" "$apt/etc/apt/trusted.gpg.d" "$apt/etc/apt/preferences.d" \
    "$apt/var/lib/apt/lists/partial" "$apt/var/cache/apt/archives/partial" "$apt/var/lib/dpkg"
  cp "$rootfs/etc/apt/sources.list.d/ubuntu.sources" "$apt/etc/apt/sources.list.d/"
  cp "$rootfs/usr/share/keyrings/ubuntu-archive-keyring.gpg" "$apt/etc/apt/trusted.gpg.d/"
  cp "$rootfs/var/lib/dpkg/status" "$apt/var/lib/dpkg/status"
  local apt_opts=(-o "Dir=$apt" -o "Dir::State::status=$apt/var/lib/dpkg/status" -o APT::Architecture=amd64
    -o Debug::NoLocking=1 -o Dir::Etc::Parts="$apt/etc/apt/apt.conf.d")
  apt-get "${apt_opts[@]}" update -qq
  apt-get "${apt_opts[@]}" install -y -qq --download-only --no-install-recommends "$@" >/dev/null
  mkdir -p "$rootfs/debs"
  cp "$apt"/var/cache/apt/archives/*.deb "$rootfs/debs/"
}

# A Debian package's files, unpacked into DIR without installing it (rclone's release is one).
host_unpack_deb() { # deb dir
  dpkg-deb -x "$1" "$2"
}

# fusermount3 without its set-user-ID bit, from Ubuntu's fuse3 package for this machine, for rclone
# in Mercbot's own namespace (packages/files/src/server/remoteMounts.js): run as the namespace's
# root, it mounts directly through /dev/fuse, which the application sandbox's `fuse` allows.
host_fuse_tools() { # tools downloads
  local TOOLS="$1" DOWNLOADS="$2"
  [ -x "$TOOLS/fuse/fusermount3" ] && return 0
  rm -f "$DOWNLOADS"/fuse3_*.deb && rm -rf "$TOOLS/fuse-package"
  (cd "$DOWNLOADS" && apt-get download fuse3 >/dev/null)
  dpkg-deb -x "$DOWNLOADS"/fuse3_*.deb "$TOOLS/fuse-package"
  mkdir -p "$TOOLS/fuse"
  install -m 0755 "$(find "$TOOLS/fuse-package" -name fusermount3 -type f | head -1)" "$TOOLS/fuse/fusermount3"
  rm -rf "$TOOLS/fuse-package"
  echo "fusermount3 unpacked for mounting in Mercbot's namespace"
}

# The programs bots' desktops run on the host beside the toolbox, the system's own where it has
# them, else Ubuntu's packages for this machine, downloaded with the host's apt and unpacked into
# TOOLS: tint2 and hsetroot, and xterm. The apps and Chrome draw with the toolbox's own Mesa, in
# gVisor (D-49).
host_desktop_tools() { # tools downloads
  local TOOLS="$1" DOWNLOADS="$2" deb
  # The bot's desktop (D-23): tint2 draws the top bar and dock, hsetroot the wallpaper.
  if { ! command -v tint2 >/dev/null 2>&1 || ! command -v hsetroot >/dev/null 2>&1; } && [ ! -x "$TOOLS/desktop/usr/bin/tint2" ]; then
    rm -f "$DOWNLOADS"/tint2_*.deb "$DOWNLOADS"/hsetroot_*.deb
    (cd "$DOWNLOADS" && apt-get download tint2 hsetroot >/dev/null)
    for deb in "$DOWNLOADS"/tint2_*.deb "$DOWNLOADS"/hsetroot_*.deb; do dpkg-deb -x "$deb" "$TOOLS/desktop"; done
    echo "Desktop bar and wallpaper tools unpacked"
  fi

  # The Terminal on bots' desktops (D-47): xterm draws it; what runs in it is in gVisor.
  if ! command -v xterm >/dev/null 2>&1 && [ ! -x "$TOOLS/desktop/usr/bin/xterm" ]; then
    rm -f "$DOWNLOADS"/xterm_*.deb "$DOWNLOADS"/libutempter0_*.deb
    (cd "$DOWNLOADS" && apt-get download xterm libutempter0 >/dev/null)
    for deb in "$DOWNLOADS"/xterm_*.deb "$DOWNLOADS"/libutempter0_*.deb; do dpkg-deb -x "$deb" "$TOOLS/desktop"; done
    echo "xterm unpacked"
  fi
}
