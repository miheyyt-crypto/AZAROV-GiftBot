# AZAROV GiftBot V2 — agent instructions

This repository is a **new** V2 project. Do not copy V1 code. Do not add `store.json`. Do not add Redis in stage 1.

## Canonical documents

- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Pending product decisions: [`docs/architecture/PENDING_PRODUCT_DECISIONS.md`](docs/architecture/PENDING_PRODUCT_DECISIONS.md)
- Phase gates: [`docs/architecture/PHASES.md`](docs/architecture/PHASES.md)

## Current gate

**Phase 0 is complete.**  
**Phase 1 is complete.**  
**Phase 2 is complete.**  
**Phase 3 is complete.**  
**Phase 4 is complete.**  
**Phase 5 is complete.**  
**Phase 6 is complete.**  
**Phase 7 is complete.**  
**Phase 8 is complete.**  
**Phase 9 is complete** (Kick OAuth POST, encrypted token storage, Worker apply of durable events without watch-time or rewards).  
**Phase 10 is complete** (instant/async game HTTP + Worker settle, CSPRNG audit, catalog-driven case/shop/task; no invented prices/odds/referral payouts).  
**Phase 11 is complete** (admin session + `super_admin` RBAC, read-only admin views, `wallet.adjust` with ledger + audit + reason).  
**Phase 12 is complete** (correlation ids, redacted structured logs, process metrics, live≠ready, read-only `wallet.reconcile`).  
**Phase 13 is complete** (15/30/50/100 concurrent Mini App users + webhook burst; latency/errors/locks/CPU/RSS report; does not claim production-ready).  
**Phase 14 is complete** (three independent systemd units, nginx API-only proxy, pg_dump backup, proven restore, artifact rollback without down-migration; secrets stay out of git).  
**Phase 15 is complete** (isolated one-way `giftbot-v1-export` importer; snapshot opening or full-history ledger; dry-run; idempotent reruns; V2 runtime does not import).  
**Phase 16 is complete** (live architecture checklist closed; remaining pending product decisions flagged off, not invented; Shop catalog prices, Paid Case odds for Нищий/Средний/Блатной, referral Kick activation +1000/+1000, referral case odds, Tasks/Welvura (#7), and auth/session TTL (#9) product-decided; load smoke 15 users + 20 webhooks; does not claim production-ready).

There is no Phase 17. Do not invent further gates.

Pre-production configuration freeze: see [`DEPLOYMENT_V2.md`](DEPLOYMENT_V2.md). Auth defaults are production-frozen in `@giftbot/auth` (initData 1800s at session create only; Mini App session 2_592_000s; admin 7200s; future skew 60s).

Local toolchain (Node 22+):

```text
npm exec --yes -- pnpm@10.15.1 install
npm exec --yes -- pnpm@10.15.1 build
npm exec --yes -- pnpm@10.15.1 lint
npm exec --yes -- pnpm@10.15.1 check
npm exec --yes -- pnpm@10.15.1 smoke
npm exec --yes -- pnpm@10.15.1 db:test
npm exec --yes -- pnpm@10.15.1 db:restore-drill
npm exec --yes -- pnpm@10.15.1 db:backup-restore-drill
npm exec --yes -- pnpm@10.15.1 deploy:test
npm exec --yes -- pnpm@10.15.1 import:test
npm exec --yes -- pnpm@10.15.1 domain:test
npm exec --yes -- pnpm@10.15.1 auth:test
npm exec --yes -- pnpm@10.15.1 rate-limit:test
npm exec --yes -- pnpm@10.15.1 observability:test
npm exec --yes -- pnpm@10.15.1 jobs:test
npm exec --yes -- pnpm@10.15.1 api:test
npm exec --yes -- pnpm@10.15.1 web:test
npm exec --yes -- pnpm@10.15.1 bot:test
npm exec --yes -- pnpm@10.15.1 worker:test
npm exec --yes -- pnpm@10.15.1 loadtest
npm exec --yes -- pnpm@10.15.1 loadtest:test
npm exec --yes -- pnpm@10.15.1 validate
npm exec --yes -- pnpm@10.15.1 validate:test
```

`DATABASE_URL` is required only for migrate/test/restore in non-production. Hello-health processes still boot without it when `NODE_ENV` is not `production`. When `NODE_ENV=production`, API/Bot/Worker fail-fast via `assertProductionRuntimeEnv` (requires `DATABASE_URL`; API also requires Telegram webhook secret, bot username, `PUBLIC_BASE_URL`, `UPLOAD_DIR`). Auth and query/webhook routes register only when `DATABASE_URL` is set; listening with a database then requires `TELEGRAM_BOT_TOKEN`. The Bot consumer also starts only when both are set. The Worker consumer starts when `DATABASE_URL` is set and does not use `TELEGRAM_BOT_TOKEN`. `TELEGRAM_WEBHOOK_SECRET` is required to accept Telegram ingress (otherwise those POSTs are 503; production boot requires it). Kick Events ingress verifies `Kick-Event-Signature` with Kick's RSA public key from `https://api.kick.com/public/v1/public-key` (process-memory cache, no invented TTL) and does not use `KICK_WEBHOOK_SECRET`. Kick OAuth start/callback are 503 until `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, `KICK_REDIRECT_URI`, and `KICK_TOKEN_ENCRYPTION_KEY` are set. Optional `TELEGRAM_LONG_POLLING=true` is dev-only (forbidden in production) and still uses persist-then-job.

## Invariants (always)

- PostgreSQL is the only source of truth.
- GET never writes.
- Money only through ledger + transaction + idempotency.
- Telegram/Kick: persist then process.
- Job `owner` is exclusive: Bot or Worker, never both.
- Worker never calls Telegram Bot API.
- Bot is not a second Mini App HTTP API.
- New wallets start at `0`.
- Pending product decisions must stay pending until the product decides them. Shop catalog prices (#5), Paid Case odds (#8 for Нищий/Средний/Блатной), referral Kick activation (#1 +1000/+1000), referral case odds, Tasks/Welvura (#7), and auth/session TTL (#9) are decided.
