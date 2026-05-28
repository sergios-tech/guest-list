#!/usr/bin/env bash
# Daily pg_dump of the guest-list DB to ~/backups/guest-list/.
# Designed to run from cron (crontab -e); see CLAUDE.md.
#
# pg_dump runs INSIDE the db container — so the host doesn't need pg_dump
# installed, and we don't have to publish the DB port. Reading
# POSTGRES_USER/POSTGRES_DB from the container's own env avoids any
# .env-parsing surprises (special chars, quoting differences).

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/guest-list}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_DIR="${COMPOSE_DIR:-$HOME/projects/guest-list}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/guests-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
cd "$COMPOSE_DIR"

# --clean --if-exists makes the dump self-restoring (drops conflicting objects
# before recreating them). --no-owner drops the role grants so a restore into
# a DB owned by a different role still works.
docker compose exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists' \
  | gzip -9 > "$OUT"

# Prune dumps older than RETENTION_DAYS.
find "$BACKUP_DIR" -type f -name 'guests-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

# Sanity: an empty dump is a sign the container is up but the DB is empty or
# misconfigured. Fail loudly so cron mail notices.
SIZE=$(stat -c%s "$OUT")
MIN_SIZE=1024
if [ "$SIZE" -lt "$MIN_SIZE" ]; then
  echo "ERROR: backup $OUT is only ${SIZE} bytes (< ${MIN_SIZE}) — likely failed" >&2
  exit 1
fi

echo "[$(date -u +%FT%TZ)] Wrote $OUT ($SIZE bytes)"
