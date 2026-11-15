#!/usr/bin/env bash
# Mounts the bots' shared files volume (D-20) at MERCBOT_FILES_DIR, so every server sees the
# same files and a server can disappear without losing any. Run it on each server before Mercbot
# starts; it formats the volume the first time and skips what's already done. Servers that start
# together format it once: each checks and formats while holding a PostgreSQL advisory lock, so the
# others wait and then find it made.
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
#   MERCBOT_FILES_CACHE_SIZE                    the most that cache holds, in MiB (default JuiceFS's own,
#                                               100 GiB): set it where the cache is in memory
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JUICEFS="$ROOT/.tools/bin/juicefs"
: "${MERCBOT_FILES_DIR:?Set MERCBOT_FILES_DIR to where the files volume should be mounted.}"
: "${MERCBOT_FILES_PASSPHRASE:?Set MERCBOT_FILES_PASSPHRASE.}"
[ -x "$JUICEFS" ] || { echo "Run npm run tools:install first." >&2; exit 1; }

export META_PASSWORD="$DB_PASSWORD" JFS_RSA_PASSPHRASE="$MERCBOT_FILES_PASSPHRASE"
META="postgres://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=${DB_SSLMODE:-disable}&search_path=juicefs"
CACHE="${MERCBOT_FILES_CACHE:-$ROOT/.tools/juicefs/cache}"
log="$CACHE/../mount.log"
mkdir -p "$MERCBOT_FILES_DIR" "$CACHE"

if [ "${1:-}" = --format ]; then
  # Run by the lock's holder below. First run anywhere: encrypt with a fresh key. The key is kept in
  # the volume's metadata, sealed with the passphrase, so servers only ever need the passphrase.
  "$JUICEFS" status "$META" >/dev/null 2>&1 && exit 0
  key="$(mktemp)"
  trap 'rm -f "$key"' EXIT
  openssl genrsa -aes256 -passout env:MERCBOT_FILES_PASSPHRASE -out "$key" 2048 2>/dev/null
  storage=(--storage "${MERCBOT_FILES_STORAGE:-file}" --bucket "${MERCBOT_FILES_BUCKET:-${MERCBOT_DATA_DIR:-$ROOT/.data}/juicefs-data/}")
  "$JUICEFS" format "${storage[@]}" --encrypt-rsa-key "$key" --trash-days 1 "$META" mercbot-files >>"$log" 2>&1 ||
    { echo "Making the files volume failed; see $log" >&2; exit 1; }
  echo "Files volume created"
  exit 0
fi

if mountpoint -q "$MERCBOT_FILES_DIR"; then
  echo "Already mounted at $MERCBOT_FILES_DIR"
else
  if ! "$JUICEFS" status "$META" >/dev/null 2>&1; then
    # The lock is the session's, so it is held until psql ends, after the format.
    PGPASSWORD="$DB_PASSWORD" PGOPTIONS="-c client_min_messages=warning" \
      psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -qX -v ON_ERROR_STOP=1 <<SQL
select pg_advisory_lock(hashtext('mercbot-files')) \g /dev/null
create schema if not exists juicefs;
\! bash '$ROOT/scripts/mount-files.sh' --format
SQL
    "$JUICEFS" status "$META" >/dev/null 2>&1 || exit 1
  fi
  # --no-agent: no debugging listener. Mercbot may bind only its own port (D-68), so JuiceFS's
  # metrics listener, which it has no switch for, is refused once and logs that; nothing uses it.
  cache_size=()
  [ -z "${MERCBOT_FILES_CACHE_SIZE:-}" ] || cache_size=(--cache-size "$MERCBOT_FILES_CACHE_SIZE")
  "$JUICEFS" mount -d --no-usage-report --no-agent --cache-dir "$CACHE" "${cache_size[@]}" --log "$log" "$META" "$MERCBOT_FILES_DIR" >/dev/null 2>>"$log" ||
    { echo "Mounting failed; see $log" >&2; exit 1; }
  echo "Mounted at $MERCBOT_FILES_DIR"
fi

# The marker tells Mercbot the volume is really there (an unmounted folder has none).
[ -e "$MERCBOT_FILES_DIR/.mercbot-files" ] || touch "$MERCBOT_FILES_DIR/.mercbot-files"
