#!/usr/bin/env bash
# Starts Mercbot (`npm start`, the Procfile's web process, a person's own copy), in its own namespace and only after
# the host's checks pass (genesis/stack.md, Deployment; D-68). When MERCBOT_FILES_DIR is set, the bots' shared files
# volume (JuiceFS on S3, D-20) is mounted first and unmounted after Mercbot stops; without it, files stay in
# <MERCBOT_DATA_DIR>/files (.data/files by default: one machine, as in development). SIGTERM and SIGINT go to
# Mercbot, which drains (bin/server.js).
set -euo pipefail
cd "$(dirname "$0")/.."
# Everything below runs in Mercbot's own user and mount namespace, or Mercbot doesn't start
# (scripts/namespace.sh, D-68).
[ -n "${MERCBOT_NAMESPACE:-}" ] || exec bash ./scripts/namespace.sh bash ./scripts/serve.sh

# Without its passphrase the volume stays off, as without MERCBOT_FILES_DIR, rather than stopping the start: files stay in
# <MERCBOT_DATA_DIR>/files, and the start log says so (keys.js).
if [ -n "${MERCBOT_FILES_DIR:-}" ] && [ -z "${MERCBOT_FILES_PASSPHRASE:-}" ]; then
  echo "MERCBOT_FILES_PASSPHRASE isn't set, so the files volume isn't mounted at $MERCBOT_FILES_DIR: files stay in this machine's data folder." >&2
  unset MERCBOT_FILES_DIR
fi
if [ -n "${MERCBOT_FILES_DIR:-}" ]; then
  bash ./scripts/mount-files.sh
  # In Mercbot's own namespace it unmounts as the namespace's root, the way JuiceFS mounted; outside
  # it (D-49), through the host's fusermount.
  if [ "$MERCBOT_NAMESPACE" = own ]; then
    trap 'umount "$MERCBOT_FILES_DIR" >/dev/null 2>&1 || true' EXIT
  else
    trap './.tools/bin/juicefs umount "$MERCBOT_FILES_DIR" >/dev/null 2>&1 || true' EXIT
  fi
fi

node ./bin/server.js &
server=$!
trap 'kill -TERM "$server" 2>/dev/null || true' TERM INT
# A signal interrupts `wait`; keep waiting until Mercbot has drained and exited.
status=0
while kill -0 "$server" 2>/dev/null; do
  if wait "$server"; then status=0; else status=$?; fi
done
exit "$status"
