#!/usr/bin/env bash
# Starts Mercbot (`npm start`, the Procfile's web process, a person's own copy), in its own namespace and only after
# the host's checks pass (genesis/stack.md, Deployment; D-68). Bots' files are kept in the files bucket when its
# settings are given (D-91), which Mercbot reaches itself, with no mount; without them, in MERCBOT_FILES_DIR or
# <MERCBOT_DATA_DIR>/files (.data/files by default: one machine, as in development). SIGTERM and SIGINT go to
# Mercbot, which drains (bin/server.js) and sends what it wrote to the bucket before it exits.
set -euo pipefail
cd "$(dirname "$0")/.."
# Everything below runs in Mercbot's own user and mount namespace, or Mercbot doesn't start
# (scripts/namespace.sh, D-68).
[ -n "${MERCBOT_NAMESPACE:-}" ] || exec bash ./scripts/namespace.sh bash ./scripts/serve.sh

# On a host whose programs come from a read-only store (MERCBOT_TOOLBOX_STORE), the bots' toolbox is made of links into
# it at every start, in MERCBOT_TOOLBOX_DIR, and the desktops' own programs take the store's fonts from it.
if [ -n "${MERCBOT_TOOLBOX_STORE:-}" ]; then
  node ./scripts/store-toolbox.mjs
  export FONTCONFIG_FILE="${FONTCONFIG_FILE:-$(realpath -m "$MERCBOT_TOOLBOX_DIR")/etc/fonts/fonts.conf}"
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
