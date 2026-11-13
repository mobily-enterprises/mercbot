# Mercbot run on Vibe64 (D-68): everything Mercbot's scripts need that depends on where it runs.
# HOSTING_SCRIPT (default scripts/hosting/vibe64.sh, relative to Mercbot's folder) names the
# hosting script; scripts/namespace.sh, scripts/install-tools.sh and scripts/build-toolbox.sh
# source it. Another host gets its own scripts/hosting/<name>.sh with the same functions
# (README → Hosting requirements), as a person's own computer has scripts/hosting/local.sh. It uses
# only what the host offers and never works around its rules.
#
# On Vibe64, Mercbot's commands and service run in its application sandbox, which grants what the
# Stack's `Sandbox allows: gvisor fuse` asks for once the workspace owner approves it, on an Ubuntu
# machine whose host setup installs Xvfb, x11vnc and openbox.

# shellcheck source=lib/ubuntu.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/ubuntu.sh"

# Mercbot may make its own user and mount namespaces (gVisor's and its own, D-47, D-68) and open
# /dev/fuse (its files volume and people's storage), or this stops, saying so. MERCBOT_UNSHARE is
# the unshare scripts/namespace.sh makes Mercbot's namespace with; gVisor is the tools' own.
host_check() {
  local error
  export MERCBOT_UNSHARE=unshare
  if ! error="$(unshare --user --map-root-user --mount true 2>&1)"; then
    host_refuse "This host doesn't let Mercbot create its own sandboxes, which its bots' computers need." \
      "${error:-unshare --user --map-root-user --mount failed.}"
  fi
  if ! error="$( { exec 3<>/dev/fuse; } 2>&1)"; then
    host_refuse "This host gives Mercbot no FUSE device (/dev/fuse), which its files volume and people's storage need." \
      "${error:-/dev/fuse could not be opened.}"
  fi
}

# Exports MERCBOT_XVFB, MERCBOT_X11VNC and MERCBOT_OPENBOX, the programs bots' computers run, or
# stops, saying which is missing. Vibe64's host setup installs them in /usr/bin.
host_display_programs() {
  host_find_display_programs "This host has no Xvfb, x11vnc or openbox, which Mercbot's bots' computers need."
}
