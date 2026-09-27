#!/bin/sh
# Restore a custom-format dump into a target database.
# Application rollback is a previous artifact (../rollback.sh), not this script.
set -eu

for arg in "$@"; do
  case "$arg" in
    *down*|*DOWN*|*-down*)
      echo "refuse: restore is pg_restore, not a down migration" >&2
      exit 2
      ;;
  esac
done

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "usage: restore.sh /var/backups/giftbot/giftbot-YYYYMMDDThhmmssZ.dump" >&2
  exit 1
fi

ENV_FILE="${GIFTBOT_ENV_FILE:-/etc/giftbot/env}"
# shellcheck disable=SC1090
. "$ENV_FILE"

TARGET_URL="${GIFTBOT_RESTORE_DATABASE_URL:-}"
if [ -z "$TARGET_URL" ]; then
  echo "set GIFTBOT_RESTORE_DATABASE_URL to an empty or replacement database; do not restore onto a live writer without a cutover plan" >&2
  exit 1
fi

# --clean drops objects inside the target. It is not a schema DOWN file.
pg_restore --no-owner --no-privileges --dbname="$TARGET_URL" "$DUMP_FILE"
