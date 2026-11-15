# Mercbot on a host whose programs come from a read-only Nix store (D-68): the store (MERCBOT_TOOLBOX_STORE, such as
# /nix) holds Mercbot and the programs the host was asked for, with their commands on PATH, and nothing is installed
# or built there. scripts/serve.sh makes the bots' toolbox from the store at every start, in MERCBOT_TOOLBOX_DIR
# (scripts/store-toolbox.mjs), and every gVisor sandbox sees the store read-only where the toolbox's links lead. The
# same functions as scripts/hosting/vibe64.sh, with HOSTING_SCRIPT=scripts/hosting/store.sh; it uses only what the host
# offers and never works around its rules.

# shellcheck source=lib/ubuntu.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/ubuntu.sh"

# The store, the toolbox's folder and gVisor on PATH (named as MERCBOT_RUNSC unless the host named its own), then the
# same checks as on Vibe64: Mercbot's own namespaces and /dev/fuse.
host_check() {
  local error
  export MERCBOT_UNSHARE=unshare
  if [ -z "${MERCBOT_TOOLBOX_STORE:-}" ] || [ ! -d "$MERCBOT_TOOLBOX_STORE" ] || [ -z "${MERCBOT_TOOLBOX_DIR:-}" ]; then
    host_refuse "On this host Mercbot's bots' toolbox comes from the store: MERCBOT_TOOLBOX_STORE names the store and MERCBOT_TOOLBOX_DIR the folder the toolbox is made in." \
      "MERCBOT_TOOLBOX_STORE=${MERCBOT_TOOLBOX_STORE:-} MERCBOT_TOOLBOX_DIR=${MERCBOT_TOOLBOX_DIR:-}"
  fi
  MERCBOT_RUNSC="${MERCBOT_RUNSC:-$(command -v runsc || true)}"
  [ -n "$MERCBOT_RUNSC" ] || host_refuse "This host has no gVisor (runsc), which Mercbot's bots' sandboxes need." "runsc: not found (PATH=$PATH)"
  export MERCBOT_RUNSC
  if ! error="$(unshare --user --map-root-user --mount true 2>&1)"; then
    host_refuse "This host doesn't let Mercbot create its own sandboxes, which its bots' computers need." \
      "${error:-unshare --user --map-root-user --mount failed.}"
  fi
  if ! error="$( { exec 3<>/dev/fuse; } 2>&1)"; then
    host_refuse "This host gives Mercbot no FUSE device (/dev/fuse), which its files volume and people's storage need." \
      "${error:-/dev/fuse could not be opened.}"
  fi
}

host_display_programs() {
  host_find_display_programs "This host has no Xvfb, x11vnc or openbox, which Mercbot's bots' computers need."
}

# Nothing is installed on this host: Mercbot's programs come with it in the store.
host_store_only() {
  host_refuse "On this host Mercbot's programs come from its store, so npm run tools:install isn't used here." "HOSTING_SCRIPT=scripts/hosting/store.sh"
}
host_toolbox_packages() { host_store_only; }
host_unpack_deb() { host_store_only; }
host_fuse_tools() { host_store_only; }
host_desktop_tools() { host_store_only; }
