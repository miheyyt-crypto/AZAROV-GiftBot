#!/bin/sh
# Switch /opt/giftbot/current to a previous release directory and restart the
# three independent units. Never runs migrate, never applies a DOWN file.
set -eu

for arg in "$@"; do
  case "$arg" in
    *down*|*DOWN*|*-down*|migrate)
      echo "refuse: application rollback is a previous compatible artifact, not a down migration" >&2
      exit 2
      ;;
  esac
done

ROOT="${GIFTBOT_ROOT:-/opt/giftbot}"
CURRENT="$ROOT/current"
RELEASES="$ROOT/releases"
PREVIOUS="${GIFTBOT_PREVIOUS:-${1:-}}"

if [ -z "$PREVIOUS" ]; then
  if [ ! -d "$RELEASES" ]; then
    echo "no releases directory at $RELEASES" >&2
    exit 1
  fi
  # Second-newest directory: current is newest, previous is the one before it.
  PREVIOUS="$(ls -1dt "$RELEASES"/* | sed -n '2p' || true)"
fi

if [ -z "$PREVIOUS" ] || [ ! -d "$PREVIOUS" ]; then
  echo "previous release directory is missing" >&2
  exit 1
fi

ln -sfn "$PREVIOUS" "$CURRENT"

# Restart only the three runtime processes. Do not start migrate.
systemctl restart giftbot-api.service giftbot-bot.service giftbot-worker.service
