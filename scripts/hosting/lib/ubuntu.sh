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

# Whether the bots' toolbox and their desktops' programs come from the host's store (D-92): never on Ubuntu or Debian,
# where scripts/install-tools.sh obtains the desktop programs the system lacks and builds the toolbox.
host_store_toolbox() { return 1; }

# A Debian package's files, unpacked into DIR without installing it (rclone's release is one).
host_unpack_deb() { # deb dir
  dpkg-deb -x "$1" "$2"
}

# Ubuntu packages for this machine, downloaded into the current folder: with the host's apt lists, or, where they hold
# none of them (a host whose lists were never fetched, which only root can refresh), with lists of the host's own
# sources fetched into DOWNLOADS/apt, as the toolbox's are.
host_apt_download() { # downloads package...
  local DOWNLOADS="$1" apt
  shift
  apt-get download "$@" >/dev/null 2>&1 && return 0
  apt="$DOWNLOADS/apt"
  mkdir -p "$apt/etc/apt/sources.list.d" "$apt/etc/apt/apt.conf.d" "$apt/etc/apt/preferences.d" \
    "$apt/var/lib/apt/lists/partial" "$apt/var/cache/apt/archives/partial"
  cp /etc/apt/sources.list.d/*.sources "$apt/etc/apt/sources.list.d/" 2>/dev/null || true
  [ -f /etc/apt/sources.list ] && cp /etc/apt/sources.list "$apt/etc/apt/sources.list"
  local apt_opts=(-o "Dir::Etc=$apt/etc/apt" -o "Dir::State=$apt/var/lib/apt" -o "Dir::Cache=$apt/var/cache/apt"
    -o Debug::NoLocking=1 -o Dir::Etc::Parts="$apt/etc/apt/apt.conf.d" -o Dir::Etc::TrustedParts=/etc/apt/trusted.gpg.d)
  apt-get "${apt_opts[@]}" update -qq
  apt-get "${apt_opts[@]}" download "$@" >/dev/null
}

# The programs bots' desktops run on the host beside the toolbox, the system's own where it has
# them, else Ubuntu's packages for this machine (host_apt_download) unpacked into
# TOOLS: tint2 and hsetroot, and xterm. The apps and Chrome draw with the toolbox's own Mesa, in
# gVisor (D-49).
host_desktop_tools() { # tools downloads
  local TOOLS="$1" DOWNLOADS="$2" deb
  # The bot's desktop (D-23): tint2 draws the top bar and dock, hsetroot the wallpaper.
  if { ! command -v tint2 >/dev/null 2>&1 || ! command -v hsetroot >/dev/null 2>&1; } && [ ! -x "$TOOLS/desktop/usr/bin/tint2" ]; then
    rm -f "$DOWNLOADS"/tint2_*.deb "$DOWNLOADS"/hsetroot_*.deb
    (cd "$DOWNLOADS" && host_apt_download "$DOWNLOADS" tint2 hsetroot)
    for deb in "$DOWNLOADS"/tint2_*.deb "$DOWNLOADS"/hsetroot_*.deb; do dpkg-deb -x "$deb" "$TOOLS/desktop"; done
    echo "Desktop bar and wallpaper tools unpacked"
  fi

  # The Terminal on bots' desktops (D-47): xterm draws it; what runs in it is in gVisor.
  if ! command -v xterm >/dev/null 2>&1 && [ ! -x "$TOOLS/desktop/usr/bin/xterm" ]; then
    rm -f "$DOWNLOADS"/xterm_*.deb "$DOWNLOADS"/libutempter0_*.deb
    (cd "$DOWNLOADS" && host_apt_download "$DOWNLOADS" xterm libutempter0)
    for deb in "$DOWNLOADS"/xterm_*.deb "$DOWNLOADS"/libutempter0_*.deb; do dpkg-deb -x "$deb" "$TOOLS/desktop"; done
    echo "xterm unpacked"
  fi
}
