#!/usr/bin/env bash
# Apply a DB migration to the running guest-list stack with a
# backup -> verify -> apply -> verify guard, so a schema change can never run
# without a fresh, verified dump to roll back to.
#
# The migrations under db/migrations/ are written idempotent (ADD COLUMN IF NOT
# EXISTS, CREATE INDEX IF NOT EXISTS, type-widening ALTERs), so re-running this
# against an already-migrated DB is a safe no-op.
#
# Usage:
#   scripts/apply-migration.sh db/migrations/NN_name.sql        # -> live POSTGRES_DB
#   CONFIRM=1 scripts/apply-migration.sh db/migrations/NN_name.sql   # skip the prompt
#   TARGET_DB=guests_test CONFIRM=1 scripts/apply-migration.sh db/migrations/NN_name.sql
#
# pg_dump and psql both run INSIDE the db container (no host tooling, no
# published port). See CLAUDE.md "Production deploy".

set -euo pipefail

MIGRATION="${1:?usage: scripts/apply-migration.sh <path-to-migration.sql>}"
COMPOSE_DIR="${COMPOSE_DIR:-$HOME/projects/guest-list}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$COMPOSE_DIR"

if [ ! -f "$MIGRATION" ]; then
  echo "ERROR: migration file not found: $MIGRATION" >&2
  exit 1
fi

# Live database name comes from the container's own env (avoids .env-parsing
# surprises); TARGET_DB overrides it for dry-runs against a disposable copy.
LIVE_DB="$(docker compose exec -T db printenv POSTGRES_DB | tr -d '\r\n')"
TARGET_DB="${TARGET_DB:-$LIVE_DB}"

echo "==> Migration:       $MIGRATION"
echo "==> Target database: $TARGET_DB"
if [ "$TARGET_DB" != "$LIVE_DB" ]; then
  echo "    NOTE: backup is of the live DB ('$LIVE_DB'), not the override target."
fi

# 1) BACK UP — reuse the canonical backup script (lands in the daily rotation).
echo "==> [1/4] Backing up '$LIVE_DB'..."
BACKUP_LINE="$(bash "$SCRIPT_DIR/backup.sh")"
echo "    $BACKUP_LINE"
BACKUP_FILE="$(printf '%s\n' "$BACKUP_LINE" | sed -n 's/.*Wrote \(.*\) ([0-9]* bytes)$/\1/p')"
if [ -z "${BACKUP_FILE:-}" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: could not determine the backup file from backup.sh output — aborting" >&2
  exit 1
fi

# 2) VERIFY the dump BEFORE any write: valid gzip + the pg_dump completion marker.
echo "==> [2/4] Verifying backup..."
gunzip -t "$BACKUP_FILE"
if ! gunzip -c "$BACKUP_FILE" | grep -q 'PostgreSQL database dump complete'; then
  echo "ERROR: backup is missing the dump-complete marker — aborting before any write" >&2
  exit 1
fi
echo "    OK: $BACKUP_FILE (gzip valid, dump complete)"

# Confirmation gate (skip with CONFIRM=1 for automation). Reads /dev/tty because
# the migration file is piped to psql on stdin.
if [ "${CONFIRM:-}" != "1" ]; then
  if [ -e /dev/tty ]; then
    printf "==> Apply %s to '%s'? type 'yes': " "$(basename "$MIGRATION")" "$TARGET_DB"
    read -r answer < /dev/tty
    [ "$answer" = "yes" ] || { echo "Aborted (no changes applied)."; exit 1; }
  else
    echo "ERROR: refusing to apply non-interactively; set CONFIRM=1 to proceed" >&2
    exit 1
  fi
fi

# 3) APPLY inside a single psql with ON_ERROR_STOP so a failure rolls back (the
#    migrations wrap their own BEGIN/COMMIT) and exits non-zero.
echo "==> [3/4] Applying to '$TARGET_DB'..."
docker compose exec -T -e APPLY_DB="$TARGET_DB" db \
  sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$APPLY_DB"' \
  < "$MIGRATION"

# 4) DONE — psql exited 0 (set -e would have aborted otherwise).
echo "==> [4/4] Migration applied successfully to '$TARGET_DB'."
echo "    Restore from this run's backup if needed:"
echo "      gunzip -c '$BACKUP_FILE' | docker compose exec -T db psql -U \"\$POSTGRES_USER\" -d $TARGET_DB"
