#!/usr/bin/env bash
# Mounts the bots' shared files volume (D-20) at MERCBOT_FILES_DIR, so every server sees the
# same files and a server can disappear without losing any. Run it on each server before Mercbot
# starts; it formats the volume the first time and skips what's already done.
#
# Environment:
#   DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD  the app's PostgreSQL; the volume's metadata
#                                               lives in its own "juicefs" schema
#   MERCBOT_FILES_DIR                           where to mount it, e.g. /srv/mercbot-files
#   MERCBOT_FILES_PASSPHRASE                    unlocks the volume's encryption key
#   MERCBOT_FILES_STORAGE, MERCBOT_FILES_BUCKET where the data goes, e.g. s3 and
#                                               https://my-bucket.s3.eu-west-1.amazonaws.com;
#                                               ACCESS_KEY and SECRET_KEY, when the storage needs
#                                               them (default: a local folder, for one machine)
#   MERCBOT_FILES_CACHE                         this machine's cache folder (default .tools/juicefs/cache)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JUICEFS="$ROOT/.tools/bin/juicefs"
: "${MERCBOT_FILES_DIR:?Set MERCBOT_FILES_DIR to where the files volume should be mounted.}"
: "${MERCBOT_FILES_PASSPHRASE:?Set MERCBOT_FILES_PASSPHRASE.}"
[ -x "$JUICEFS" ] || { echo "Run npm run tools:install first." >&2; exit 1; }

export META_PASSWORD="$DB_PASSWORD" JFS_RSA_PASSPHRASE="$MERCBOT_FILES_PASSPHRASE"
META="postgres://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=${DB_SSLMODE:-disable}&search_path=juicefs"
CACHE="${MERCBOT_FILES_CACHE:-$ROOT/.tools/juicefs/cache}"
mkdir -p "$MERCBOT_FILES_DIR" "$CACHE"

if mountpoint -q "$MERCBOT_FILES_DIR"; then
  echo "Already mounted at $MERCBOT_FILES_DIR"
else
  if ! "$JUICEFS" status "$META" >/dev/null 2>&1; then
    # First run anywhere: encrypt with a fresh key. The key is kept in the volume's metadata,
    # sealed with the passphrase, so servers only ever need the passphrase.
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -qc "create schema if not exists juicefs"
    key="$(mktemp)"
    trap 'rm -f "$key"' EXIT
    openssl genrsa -aes256 -passout env:MERCBOT_FILES_PASSPHRASE -out "$key" 2048 2>/dev/null
    storage=(--storage "${MERCBOT_FILES_STORAGE:-file}" --bucket "${MERCBOT_FILES_BUCKET:-${MERCBOT_DATA_DIR:-$ROOT/.data}/juicefs-data/}")
    "$JUICEFS" format "${storage[@]}" --encrypt-rsa-key "$key" --trash-days 1 "$META" mercbot-files >/dev/null 2>&1
    echo "Files volume created"
  fi
  log="$CACHE/../mount.log"
  # --no-agent: no debugging listener. Mercbot may bind only its own port (D-68), so JuiceFS's
  # metrics listener, which it has no switch for, is refused once and logs that; nothing uses it.
  "$JUICEFS" mount -d --no-usage-report --no-agent --cache-dir "$CACHE" --log "$log" "$META" "$MERCBOT_FILES_DIR" >/dev/null 2>>"$log" ||
    { echo "Mounting failed; see $log" >&2; exit 1; }
  echo "Mounted at $MERCBOT_FILES_DIR"
fi

# The marker tells Mercbot the volume is really there (an unmounted folder has none).
[ -e "$MERCBOT_FILES_DIR/.mercbot-files" ] || touch "$MERCBOT_FILES_DIR/.mercbot-files"
