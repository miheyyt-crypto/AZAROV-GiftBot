# Phase gates

Canonical architecture: [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)

**Current phase:** 16 — Final validation — **complete**.  
There is no Phase 17. Do not invent further implement commands.

Each later phase needs its own explicit implement command after acceptance of the previous gate.

---

## Phase 0 — Architecture foundation

- **Goal:** record and lock the approved architecture and invariants.
- **Implemented:** this documentation set only.
- **Depends on:** none.
- **Acceptance:** the seven review points are closed; checklist is recorded; pending decisions are separated; no Phase 1+ code or scaffold exists.
- **Out of scope:** repository toolchain, `package.json`, apps, schema, routes, bot, worker, Mini App, domain code, V1 importer.

## Phase 1 — Repository / infrastructure foundation

- **Goal:** empty monorepo and toolchain.
- **Will implement:** pnpm workspaces, TypeScript, app stubs, lint/CI smoke, env-skeleton validation.
- **Depends on:** approved architecture + `IMPLEMENT PHASE 1`.
- **Acceptance:** three apps build without domain; no `store.json`.
- **Out of scope:** money schema, UI, bot logic, V1.
- **Status:** complete. Workspace packages: `@giftbot/config`, `@giftbot/api`, `@giftbot/bot`, `@giftbot/worker`. Each process exposes only `GET /health/live` (no DB).

## Phase 2 — Database

- **Goal:** schema and forward-only migrations.
- **Will implement:** logical entities from the architecture, unique keys, `opening_balance_minor`.
- **Depends on:** Phase 1.
- **Acceptance:** migrations on an empty DB; restore drill; no second event table with the same payload.
- **Out of scope:** product amounts; down as production rollback; runtime V1 import.
- **Status:** complete. Package `@giftbot/db` has a single `inbound_events` store (variant A), wallet ledger + `opening_balance_minor`, exclusive `jobs.owner`, forward-only `0000_phase2_foundation.sql`, constraint tests, and a restore drill. No down migrations.

## Phase 3 — Domain core

- **Goal:** domain services without HTTP/UI.
- **Will implement:** `Wallet.apply`, reconciliation formula, state machines, instant/async transitions without concrete games.
- **Depends on:** Phase 2.
- **Acceptance:** race/duplicate/negative/reversal tests; new wallet = 0.
- **Out of scope:** HTTP UI; choosing referral activation; external API inside TX.
- **Status:** complete. Package `@giftbot/domain` owns `Wallet.apply`, reconcile, reversal, user provision, referral attribution without auto-activation, instant/async game settlement, and pure state machines.

## Phase 4 — Authentication

- **Goal:** initData → identity → one active session.
- **Will implement:** HMAC, user provision, rotate, logout, 401, admin auth skeleton.
- **Depends on:** Phase 3.
- **Acceptance:** repeat auth does not accumulate active sessions; GET does not create a session.
- **Out of scope:** eternal initData; an unmarked invented TTL presented as final product truth.
- **Status:** complete. Package `@giftbot/auth` verifies Telegram initData (HMAC + `auth_date`), identifies/creates the user, rotates one Mini App session, and issues a hashed opaque token. Admin auth is a separate rotate of `admin_sessions` and requires an `admin_role_assignments` row. Auth TTLs later **production-frozen** (decision #9): initData **1800s** (checked only at session create), Mini App session **2_592_000s**, admin **7200s**, future skew **60s**. Write-only routes: `POST /auth/telegram`, `POST /auth/logout`, `POST /admin/auth`, `POST /admin/logout`. No `GET /bootstrap`.

## Phase 5 — API

- **Goal:** Fastify queries/commands, ingress, small bootstrap.
- **Will implement:** routes, GET purity, idempotent POST, rate-limit port + memory, webhook persist + enqueue.
- **Depends on:** Phase 4.
- **Acceptance:** GET has no writes; webhook does not apply domain; bootstrap is small.
- **Out of scope:** processing updates/Kick in the handler; huge payloads.
- **Status:** complete. Fastify API adds read-only `GET /bootstrap` and `GET /health/ready` (`SELECT 1`), Telegram/Kick webhook persist+enqueue (`inbound_events` + one job, payload `{ inbound_event_id }` only), HTTP idempotency helper, and `@giftbot/rate-limit` memory port. Ingress does not apply domain or `Wallet.apply`. Rate-limit numbers are `TEMPORARY_UNCONFIRMED`.

## Phase 6 — Mini App

- **Goal:** staged startup.
- **Will implement:** Vite/React, shell, lazy sections, skeletons.
- **Depends on:** Phase 5.
- **Acceptance:** request budget until usable UI; no business decisions in React.
- **Out of scope:** RNG, eligibility, admin UI without API enforcement.
- **Status:** complete. `@giftbot/web` is a Vite/React Mini App with staged startup (auth only if no session, then bootstrap, then shell, then lazy `GET /sections/{active}`), skeletons, timeouts, and section-local retry. React only renders server fields. No games, RNG, or admin UI.

## Phase 7 — Telegram Bot

- **Goal:** sole Telegram I/O + bot-job consumer.
- **Will implement:** grammY in Bot process; process inbound; send jobs.
- **Depends on:** Phase 5 + Phase 3.
- **Acceptance:** duplicate `update_id` is safe; Worker does not send Telegram; Bot has no Mini App HTTP.
- **Out of scope:** Kick; giveaway settle; a second public API.
- **Status:** complete. Bot process consumes only `owner=bot` jobs (`SKIP LOCKED`), applies inbound Telegram updates after persist (identify, optional `/start` referral attribution, no auto-activate), and sends via `telegram.send_message` through an injected Telegram port (grammY in production). Duplicate `update_id` is one business effect. Worker cannot claim bot jobs. Bot HTTP is health-only (not a Mini App API). Optional `TELEGRAM_LONG_POLLING=true` persists through the same ingress path. Worker process is unchanged.

## Phase 8 — Worker / Jobs

- **Goal:** `SKIP LOCKED`, retry, dead letter, stale lock, owner filter.
- **Will implement:** claim `owner=worker`; backoff; reclaim.
- **Depends on:** Phase 2–5 (may overlap 6–7 after 5).
- **Acceptance:** worker kill yields one money effect; Bot jobs are not claimable by Worker.
- **Out of scope:** Redis; Telegram API.
- **Status:** complete. Worker consumes only `owner=worker` jobs (`SKIP LOCKED`), with exponential backoff + jitter, dead letter at `max_attempts`, and stale-lock reclaim. Bot jobs are not claimable or reclaimable by Worker. `wallet.apply` is a trusted ledger transport (not a product reward); kill + reclaim yields one `Wallet.apply` effect. `wallet.reconcile` is read-only and never raw-updates balance. Kick inbound is persist-then-ack only — no watch-time/reward apply (Phase 9). Worker HTTP is health-only and never calls Telegram. Retry/lock numbers are `TEMPORARY_UNCONFIRMED`.

## Phase 9 — Kick

- **Goal:** OAuth POST, token storage, durable events, Worker apply of raw events.
- **Will implement:** storage and apply without treating watch-time as a fact.
- **Depends on:** Phase 8.
- **Acceptance:** event id replay has no second effect; OAuth start is not GET.
- **Out of scope:** chat presence = watch; rewards for an unchosen proof rule.
- **Status:** complete. `POST /kick/oauth/start` issues PKCE state (GET start is 404/405). Callback consumes `kick_oauth_states` once, exchanges the code outside any money transaction, and stores AES-256-GCM ciphertext on `kick_accounts`. Worker `kick.process_inbound_event` applies the durable payload (link pointer, replay is a no-op) without treating chat/presence as watch-time and without `Wallet.apply`. `kick.refresh_token` rotates stored tokens through an injected Kick port. Scope `user:read` and state TTL 600s are `TEMPORARY_UNCONFIRMED`. Mini App Kick section can POST-start OAuth; it does not load watch history.

## Phase 10 — Games / Economy

- **Goal:** games/cases/shop/tasks/referral payouts using **approved** numbers.
- **Will implement:** instant TX and async settle; CSPRNG; audit.
- **Depends on:** Phase 3, 5, 8 + the pending decisions that are actually enabled.
- **Acceptance:** client cannot set result; replay is idempotent; GET does not settle.
- **Out of scope:** invented coefficients; client-side win.
- **Status:** complete. `POST /games/:id/play` accepts only `game_id` + catalog `allowedBetMinor` + `Idempotency-Key`. Client result/prize/seed fields are rejected. Instant rounds settle in one TX with CSPRNG → `rng_draws`. Async rounds debit then enqueue `game.settle_async` (`owner=worker`). `GET /rounds/:id` and `GET /games` do not settle. Cases/shop/tasks run only from catalog rows already in PostgreSQL (price/weight/reward on the row). Referral payout stays disabled (activation + amounts still pending). No production seed of prices, odds, RTP, or currency. Mini App Play section posts intent only.

## Phase 11 — Admin

- **Goal:** RBAC + views + safe adjustments.
- **Will implement:** `super_admin`, admin session, audit, `wallet.adjust`.
- **Depends on:** Phase 3, 5, 8.
- **Acceptance:** balance cannot change without ledger + audit + reason.
- **Out of scope:** a full role matrix if still pending.
- **Status:** complete. Admin API uses `admin_sessions` + current `admin_role_assignments`. `super_admin` is a wildcard; extra roles stay pending and are not seeded. `GET /admin/me`, user/wallet/ledger views are read-only. `POST /admin/users/:userId/wallet/adjust` requires reason + `Idempotency-Key`, applies `Wallet.apply` type `admin_adjustment` (including frozen wallets), and writes `audit_logs` in the same transaction. Replay does not write a second ledger or audit row. Mini App tokens cannot call admin routes. No Mini App admin UI and no seeded admin identities.

## Phase 12 — Observability

- **Goal:** correlation, metrics, health, reconcile job.
- **Depends on:** living Phase 5/7/8.
- **Acceptance:** live ≠ ready; request → job → tx is traceable; no secrets in logs.
- **Out of scope:** writes from health checks.
- **Status:** complete. Package `@giftbot/observability` issues `request_id` / `correlation_id`, redacts secrets from structured logs, and exposes process-local counters. API/Bot/Worker `GET /health/live` stays process-only; `GET /health/ready` is a read-only `SELECT 1` (503 without a database). `GET /metrics` does not write. Inbound events and jobs store `correlation_id` (inbound job payload remains `{ inbound_event_id }`). Ledger metadata carries the same ids when a job or HTTP request applies money. Worker `wallet.reconcile` is read-only: mismatch increments a metric, logs an incident, and never raw-updates balance. Sweep enqueue uses `TEMPORARY_UNCONFIRMED` 60s windows.

## Phase 13 — Load testing

- **Goal:** 15/30/50/100 concurrent users + webhook burst.
- **Depends on:** at least Phase 6–8; economy if Phase 10 exists.
- **Acceptance:** latency/errors/locks/CPU/RSS report; blockers fixed.
- **Out of scope:** calling the product production-ready because unit tests pass.
- **Status:** complete. `tools/loadtest` (`@giftbot/loadtest`) runs Mini App auth + read-only bootstrap/section/live at 15/30/50/100 concurrent users, then a 200-event Telegram webhook burst. It reports latency (p50/p95/p99), HTTP status counts, `pg_locks` waiting/granted, and process CPU/RSS. The report never claims production-ready. Harness rate limits are a `TEMPORARY_UNCONFIRMED` override because one shared IP would hit the default 120/60s cap. No catalog/game play (prices/odds still pending). Health ready is re-checked after load and does not write.

## Phase 14 — Production deployment

- **Goal:** VPS, three systemd units, proxy, backup, proven restore, app rollback without down-migration.
- **Depends on:** Phase 12–13.
- **Acceptance:** processes are independent; migrate is expand-safe; secrets are not in git.
- **Out of scope:** V1 import; one process that does everything.
- **Status:** complete. `deploy/` ships four systemd units (oneshot migrate + independent API/Bot/Worker), nginx that serves `apps/web/dist` and proxies Mini App/API/webhooks to `127.0.0.1:3000` only, host env example with empty secrets, `pg_dump`/`pg_restore` scripts, and artifact rollback that refuses `DOWN`. `tools/deploy` (`@giftbot/deploy`) checks those invariants. `pnpm db:backup-restore-drill` recovers a probe row from a file backup (logical JSON always; `pg_dump` custom format when the binary is present). No V1 importer and no combined process.

## Phase 15 — V1 import

- **Goal:** isolated one-way importer.
- **Will implement:** read-only V1, mapping, dry-run, opening-balance snapshot or history without double count, reconciliation.
- **Depends on:** stable Phase 14.
- **Acceptance:** reruns are idempotent; V2 runtime does not import.
- **Out of scope:** copying `store.json` into a runtime store.
- **Status:** complete. `tools/v1-importer` (`@giftbot/v1-importer`) reads a `giftbot-v1-export` file only (rejects `store.json` blobs). Default snapshot mode sets `opening_balance_minor` + `balance_minor` with an empty V1 ledger. `full_history` keeps opening at 0 and applies `import:v1:{legacy_tx_id}` rows; both modes together are refused. Dry-run writes nothing. Reruns skip via `v1_import_identities`. API/Bot/Worker/Web do not depend on the tool and jobs have no import type.

## Phase 16 — Final validation

- **Goal:** live checklist + load smoke.
- **Depends on:** Phase 14, and Phase 15 if used.
- **Acceptance:** checklist closed; pending items are decided or flagged off.
- **Out of scope:** new features that skip gates.
- **Status:** complete. `tools/validate` (`@giftbot/validate`) closes the live architecture checklist (PostgreSQL-only, no Redis, exclusive job owners, API-only proxy, isolated V1 importer, referral payout still disabled). At close, all 14 pending product decisions were **FLAG OFF**. Shop catalog prices (#5) were later product-decided for Shop Orders; the remaining 13 stay flagged off. Load smoke is 15 concurrent Mini App users + 20 Telegram webhooks; ready stays read-only. The report never claims production-ready.
