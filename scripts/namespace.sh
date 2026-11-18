#!/usr/bin/env bash
# Runs a command in Mercbot's own user and mount namespace (D-68), where it is the namespace's
# root, and where its gVisor sandboxes start. Nothing mounts there since bots' files left FUSE (D-91). The hosting
# script (HOSTING_SCRIPT, default scripts/hosting/vibe64.sh) checks first that the host allows this and has the
# computers' X programs, and stops Mercbot saying so if not: computers are never switched off quietly. It also names
# the unshare to use (MERCBOT_UNSHARE: on a person's own computer, the installer's trusted copy). With
# MERCBOT_SANDBOX_USER set (D-49), sandboxes run as that user through sudo, which can't work inside a user namespace,
# so Mercbot stays outside.
#
#   bash scripts/namespace.sh --check            checks this host, and nothing else
#   bash scripts/namespace.sh --check-install    what scripts/install-tools.sh checks first: the same, except on a host
#                                                whose toolbox comes from its store (host_store_toolbox, D-92), where
#                                                the install brings only downloads and the host is checked at start
#   bash scripts/namespace.sh COMMAND...         runs COMMAND in Mercbot's namespace
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ "$#" -gt 0 ] || { echo "Usage: bash scripts/namespace.sh --check | COMMAND..." >&2; exit 2; }
if [ -n "${MERCBOT_NAMESPACE:-}" ] && [ "$1" != "--check" ] && [ "$1" != "--check-install" ]; then exec "$@"; fi

hosting="${HOSTING_SCRIPT:-scripts/hosting/vibe64.sh}"
if [ ! -f "$ROOT/$hosting" ]; then
  echo "HOSTING_SCRIPT is $hosting, which doesn't exist in Mercbot's folder. The hosting scripts there are: $(cd "$ROOT" && ls -- scripts/hosting/*.sh | tr '\n' ' ')(README → Hosting requirements)." >&2
  exit 1
fi
# shellcheck source=hosting/vibe64.sh
. "$ROOT/$hosting"
if [ "$1" = "--check-install" ] && host_store_toolbox; then exit 0; fi
host_check
host_display_programs
if [ "$1" = "--check" ] || [ "$1" = "--check-install" ]; then exit 0; fi

if [ -n "${MERCBOT_SANDBOX_USER:-}" ]; then
  export MERCBOT_NAMESPACE=host
  exec "$@"
fi
export MERCBOT_NAMESPACE=own
exec "$MERCBOT_UNSHARE" --user --map-root-user --mount -- "$@"
