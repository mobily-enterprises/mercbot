#!/usr/bin/env bash
# Runs bots' gVisor sandboxes as a separate, powerless user (D-49). Run once as root on each server,
# from Mercbot's folder, after `npm run tools:install`:
#
#   sudo bash scripts/setup-sandbox-user.sh <server user> <files volume> <data folder> <sandbox temp folder>
#
# then set MERCBOT_SANDBOX_USER=mercbot-sandbox and TMPDIR=<sandbox temp folder> for the server and
# restart it. Sandboxes then run as `mercbot-sandbox` through one sudo rule that allows only
# Mercbot's runsc, so a program that got out of gVisor would be that user: it can't read the
# server's settings file, its process environment (the database password and keys) or anything
# else of the server user's. The two users share the group `mercbot-shared`, which owns the folders
# both write (the files volume, bots' browser profiles, the sandboxes' own folders); new folders
# there keep the group (setgid) and both write with umask 002.
set -euo pipefail

SERVER_USER="${1:?the user the Mercbot server runs as}"
FILES_DIR="${2:?the files volume (MERCBOT_FILES_DIR)}"
DATA_DIR="${3:?the Mercbot data folder (MERCBOT_DATA_DIR, default .data)}"
SANDBOX_TMP="${4:?a folder for the temporary files of sandboxes, used as TMPDIR, e.g. /var/lib/mercbot-sandbox/tmp}"
APP_DIR="$(pwd)"
TOOLS_DIR="${MERCBOT_TOOLS_DIR:-$APP_DIR/.tools}"
SANDBOX_USER=mercbot-sandbox
GROUP=mercbot-shared

[ "$(id -u)" = 0 ] || { echo "Run this as root." >&2; exit 1; }
[ -x "$TOOLS_DIR/bin/runsc" ] || { echo "No gVisor at $TOOLS_DIR/bin/runsc: run npm run tools:install first." >&2; exit 1; }
id "$SERVER_USER" >/dev/null

getent group "$GROUP" >/dev/null || groupadd --system "$GROUP"
id "$SANDBOX_USER" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid "$GROUP" "$SANDBOX_USER"
usermod -aG "$GROUP" "$SERVER_USER"
# KVM access, in case it measures faster here (MERCBOT_GVISOR_PLATFORM=kvm, docs/deployment.md).
getent group kvm >/dev/null && usermod -aG kvm "$SANDBOX_USER"

# The one thing the server may do as the sandbox user: run Mercbot's runsc, leaving files
# group-writable.
cat > /etc/sudoers.d/mercbot-sandbox <<SUDO
Defaults>$SANDBOX_USER umask=0002, umask_override, !requiretty
$SERVER_USER ALL=($SANDBOX_USER) NOPASSWD: ${MERCBOT_RUNSC:-$TOOLS_DIR/bin/runsc}
SUDO
chmod 440 /etc/sudoers.d/mercbot-sandbox
visudo -cf /etc/sudoers.d/mercbot-sandbox

# Folders both write: shared group, group-writable, new folders keep the group.
mkdir -p "$SANDBOX_TMP" "$DATA_DIR/computers"
for dir in "$FILES_DIR" "$DATA_DIR/computers" "$SANDBOX_TMP"; do
  chgrp -R "$GROUP" "$dir"
  chmod -R g+rwX "$dir"
  find "$dir" -type d -exec chmod g+s {} +
done
chmod o-rwx "$SANDBOX_TMP"

# What the sandbox user reads: gVisor, the toolbox, the apps and Stagehand's extension. Nothing
# else of Mercbot's: its settings file stays the server user's alone.
chgrp -R "$GROUP" "$TOOLS_DIR"
chmod -R g+rX "$TOOLS_DIR"
chgrp "$GROUP" "$APP_DIR" && chmod g+x "$APP_DIR"
for dir in node_modules node_modules/@browserbasehq; do chgrp "$GROUP" "$APP_DIR/$dir" && chmod g+x "$APP_DIR/$dir"; done
chgrp -R "$GROUP" "$APP_DIR/node_modules/@browserbasehq/stagehand" && chmod -R g+rX "$APP_DIR/node_modules/@browserbasehq/stagehand"
[ -f "$APP_DIR/.env" ] && chmod 600 "$APP_DIR/.env"

echo "Done. Set MERCBOT_SANDBOX_USER=$SANDBOX_USER and TMPDIR=$SANDBOX_TMP for Mercbot's server, then restart it."
