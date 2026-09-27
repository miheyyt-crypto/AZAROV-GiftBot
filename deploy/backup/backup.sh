#!/bin/sh
# Custom-format PostgreSQL dump for the VPS. Secrets stay in /etc/giftbot/env.
set -eu

for arg in "$@"; do
  case "$arg" in
    *down*|*DOWN*)
      echo "refuse: backup is pg_dump, not a down migration" >&2
      exit 2
      ;;
  esac
done

ENV_FILE="${GIFTBOT_ENV_FILE:-/etc/giftbot/env}"
BACKUP_DIR="${GIFTBOT_BACKUP_DIR:-/var/backups/giftbot}"

# shellcheck disable=SC1090
. "$ENV_FILE"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is empty in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/giftbot-${STAMP}.dump"

pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$OUT"
echo "$OUT"
