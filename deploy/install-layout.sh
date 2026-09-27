#!/bin/sh
# Host directories for a Linux VPS. Does not write secrets or start processes.
set -eu

ROOT="${GIFTBOT_ROOT:-/opt/giftbot}"
install -d -m 0755 "$ROOT/releases" "$ROOT/shared" /var/backups/giftbot /etc/giftbot /etc/giftbot/tls

if [ ! -f /etc/giftbot/env ]; then
  echo "copy deploy/env/giftbot.env.example to /etc/giftbot/env and fill secrets on the host" >&2
fi

if ! id giftbot >/dev/null 2>&1; then
  echo "create a system user: useradd --system --home $ROOT --shell /usr/sbin/nologin giftbot" >&2
fi
