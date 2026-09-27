# Production deployment (Phase 14)

Linux VPS layout for three independent processes, a static Mini App, PostgreSQL, and artifact rollback. This is not a claim that the product is production-ready.

## Processes

| Unit | ExecStart | Public HTTP |
|---|---|---|
| `giftbot-migrate.service` | `node packages/db/dist/migrate.js` (oneshot) | none |
| `giftbot-api.service` | `node apps/api/dist/main.js` | nginx → `127.0.0.1:3000` |
| `giftbot-bot.service` | `node apps/bot/dist/main.js` | localhost health only (`3001`) |
| `giftbot-worker.service` | `node apps/worker/dist/main.js` | localhost health only (`3002`) |

Web is static files from `apps/web/dist`. It is not a fourth Node unit. Do not merge API, Bot, and Worker into one process.

Release tree:

```text
/opt/giftbot/releases/<id>   built monorepo (pnpm install + pnpm build)
/opt/giftbot/current         symlink to the active release
/etc/giftbot/env             secrets (not in git)
/etc/giftbot/tls             certificates (not in git)
/var/backups/giftbot         pg_dump custom-format files
```

## Deploy

1. Create host layout with `install-layout.sh`. Create the `giftbot` system user.
2. Copy `deploy/env/giftbot.env.example` to `/etc/giftbot/env` and fill secrets on the host.
3. Unpack a built release under `/opt/giftbot/releases/<id>` and point `current` at it.
4. Install the four systemd units from `deploy/systemd/`. Enable migrate plus the three runtime units.
5. Install `deploy/nginx/giftbot.conf`. Put TLS material under `/etc/giftbot/tls/`.
6. Run `systemctl start giftbot-migrate.service` once per release that needs schema expand. Concurrent migrate uses advisory lock `872_514`; the oneshot is still the production path.
7. Start `giftbot-api`, `giftbot-bot`, and `giftbot-worker` independently.

Production Telegram uses webhooks on the API. Leave `TELEGRAM_LONG_POLLING=false`.

## Backup and restore

- Backup: `deploy/backup/backup.sh` → `pg_dump --format=custom`.
- Restore: `deploy/backup/restore.sh <file>` into `GIFTBOT_RESTORE_DATABASE_URL` (empty or replacement database), then cut over. Prove the dump recovers data before swapping writers.
- The existing `pnpm db:restore-drill` clones via `CREATE DATABASE … TEMPLATE`. `pnpm db:backup-restore-drill` also proves a file backup recovers a probe row.

## Application rollback

`deploy/rollback.sh` switches `/opt/giftbot/current` to the previous release directory and restarts the three runtime units. It refuses `down` / `migrate` arguments.

Rollback is a previous compatible artifact. It is not `DOWN`, not a data drop, and not `drizzle-kit drop`. Contract DDL only after old code is gone (ARCHITECTURE.md §8).
