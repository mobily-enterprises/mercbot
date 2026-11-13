# Mercbot on a person's own computer (D-68, docs/standalone-plan.md): Ubuntu 24.04 or Debian 12 on
# x86_64, with HOSTING_SCRIPT=scripts/hosting/local.sh. The same functions as scripts/hosting/vibe64.sh;
# every refusal says which command fixes it.
#
# Ubuntu lets only programs AppArmor trusts make user namespaces
# (kernel.apparmor_restrict_unprivileged_userns). Mercbot never switches that off for the whole
# computer: the installer's root step (question 2) puts root's own copies of unshare and runsc in
# MERCBOT_TRUSTED_DIR (/usr/local/lib/mercbot) under an AppArmor profile that lets just those two
# make namespaces. Where they are there, Mercbot uses them (MERCBOT_UNSHARE, MERCBOT_RUNSC); where
# the computer allows namespaces anyway (Debian 12), the system's unshare and the tools' runsc do.

# shellcheck source=lib/ubuntu.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/ubuntu.sh"

LOCAL_TRUSTED="${MERCBOT_TRUSTED_DIR:-/usr/local/lib/mercbot}"
LOCAL_ROOT_STEP="Run Mercbot's installer again and agree to its root step."

# The root step's copy of a program, only if root owns it and nobody else may change it.
local_trusted() { # name
  local copy="$LOCAL_TRUSTED/$1" owner mode
  owner="$(stat -c %u "$copy")"
  mode="$(stat -c %a "$copy")"
  if [ "$owner" != 0 ] || [ $((8#$mode & 8#022)) != 0 ]; then
    host_refuse "This computer's copy of $1 for Mercbot isn't root's own, so Mercbot won't trust it. $LOCAL_ROOT_STEP" \
      "$copy: owner $owner, mode $mode (it must be root's, writable by root alone)"
  fi
  printf '%s' "$copy"
}

host_check() {
  local error unshare runsc tools_runsc
  [ "$(uname -m)" = x86_64 ] ||
    host_refuse "Mercbot runs on x86_64 computers only for now, because its bots' toolbox is built for them." "uname -m: $(uname -m)"
  unshare="$(command -v unshare || true)"
  if [ -e "$LOCAL_TRUSTED/unshare" ]; then unshare="$(local_trusted unshare)" || exit 1; fi
  if ! error="$("${unshare:-unshare}" --user --map-root-user --mount true 2>&1)"; then
    host_refuse "This computer doesn't let Mercbot make its own sandboxes, which its bots' computers need. $LOCAL_ROOT_STEP" \
      "${error:-unshare --user --map-root-user --mount failed.}"
  fi
  export MERCBOT_UNSHARE="${unshare:-unshare}"
  tools_runsc="${MERCBOT_TOOLS_DIR:-${ROOT:-.}/.tools}/bin/runsc"
  if [ -e "$LOCAL_TRUSTED/runsc" ]; then
    # gVisor updated with the tools needs the root step again, or bots would run in the old one.
    if [ -x "$tools_runsc" ] && ! cmp -s "$LOCAL_TRUSTED/runsc" "$tools_runsc"; then
      host_refuse "Mercbot's gVisor was updated, and this computer's trusted copy is still the old one. $LOCAL_ROOT_STEP" \
        "$LOCAL_TRUSTED/runsc differs from $tools_runsc"
    fi
    runsc="$(local_trusted runsc)" || exit 1
    export MERCBOT_RUNSC="$runsc"
  elif [ "$unshare" = "$LOCAL_TRUSTED/unshare" ]; then
    host_refuse "This computer has a trusted copy of unshare for Mercbot but none of runsc, which its bots' sandboxes need. $LOCAL_ROOT_STEP" \
      "$LOCAL_TRUSTED/runsc: not found"
  fi
  if ! error="$( { exec 3<>/dev/fuse; } 2>&1)"; then
    host_refuse "This computer gives Mercbot no FUSE device (/dev/fuse), which people's storage needs. Install FUSE with: sudo apt-get install fuse3" \
      "${error:-/dev/fuse could not be opened.}"
  fi
}

host_display_programs() {
  host_find_display_programs "This computer lacks Xvfb, x11vnc or openbox, which Mercbot's bots' computers need. Install them with: sudo apt-get install xvfb x11vnc openbox"
}
