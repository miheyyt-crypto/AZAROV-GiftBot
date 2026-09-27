# AZAROV GiftBot V2 — Final Architecture

**Status:** Approved  
**Document type:** Phase 0 architecture foundation  
**Form:** Modular monolith in one monorepo  
**Source of truth:** PostgreSQL only  

This file is the canonical record of the approved FINAL V2 ARCHITECTURE.  
It does not change that architecture. It does not invent product or economy values.

Implementation of Phase 1+ is forbidden until an explicit user command: `IMPLEMENT PHASE 1`.

Related Phase 0 artifacts:

- [`docs/architecture/PENDING_PRODUCT_DECISIONS.md`](docs/architecture/PENDING_PRODUCT_DECISIONS.md)
- [`docs/architecture/PHASES.md`](docs/architecture/PHASES.md)
- [`AGENTS.md`](AGENTS.md)

---

## 1. Purpose and non-negotiable principles

V2 is a Telegram Bot + Telegram Mini App. The client is never the source of truth. Game results, money, referrals, tasks, cases, and giveaways are decided only on the server.

### 1.1 Forbidden

- `store.json` or any large JSON blob as a runtime source of truth
- Writes inside GET
- Business rules in React
- Critical external HTTP inside a DB transaction
- Large Mini App bootstrap payloads
- Blocking filesystem I/O on the request path
- Runtime dependency on V1
- Redis in stage 1
- Microservices

### 1.2 Required

- All money goes through a ledger + idempotency key + DB transaction
- Replaying a webhook or event must not pay a reward twice
- Telegram and Kick: durable persist first, then async processing
- API, Bot, and Worker are separate processes and remain horizontally safe
- Domain logic is testable without UI and without Telegram
- Unknown business numbers and rules are **PENDING PRODUCT DECISION**, not facts

### 1.3 V1 lessons — risk classes, not a proven root cause

V1 had stability problems when several users opened the Mini App at once. The root cause was not proven. V2 removes these **risk classes**:

| Risk class | V2 response |
|---|---|
| Large JSON store | PostgreSQL, normalized tables |
| Large startup read/write | Small bootstrap + lazy sections |
| Blocking filesystem | No runtime file-store |
| Request-path writes | GET is read-only; writes are commands or jobs |
| Startup burst | Staged startup, limits, queue |
| Oversized bootstrap | Explicit small bootstrap contract |
| Sync external API on request | Ingress → event → job |
| Webhook bursts | Fast persist + worker/bot consume |
| Race conditions | `FOR UPDATE`, unique keys |
| Weak idempotency | Mandatory idempotency keys |
| Memory pressure | Pagination, no giant payloads |
| Unsafe horizontal scale | Shared-nothing processes + DB locks |

---

## 2. Final process responsibilities

One repository, one domain model, three runtime processes plus a static Mini App.

```text
                    ┌──────────────────┐
   Telegram Mini App│  Web (Vite/React) │  HTTP API only
                    └────────┬─────────┘
                             │ HTTPS
                    ┌────────▼─────────┐
 Telegram/Kick ────►│   API process    │  REST, webhook ingress, admin
 webhooks           │                  │
                    └───┬──────────┬───┘
                        │ enqueue  │
                        ▼          ▼
              ┌─────────────┐  ┌──────────────┐
              │ Worker      │  │ Bot process  │
              │ owner=worker│  │ owner=bot    │
              └──────┬──────┘  └──────┬───────┘
                     │                │
                     ▼                ▼
              ┌─────────────────────────────┐
              │         PostgreSQL          │
              │  SoT + jobs + events + ledger│
              └─────────────────────────────┘
```

Logical packages (not created in Phase 0): `apps/api`, `apps/bot`, `apps/worker`, `apps/web`, `packages/{db,domain,contracts,auth,jobs,observability,config,rate-limit,crypto}`, later `tools/v1-importer`, `tools/loadtest`. Admin UI may be a Web section or a separate origin; that does not change the access model.

### 2.1 Ownership rule

Every job has exactly one `owner`: `bot` or `worker`.  
API never consumes jobs.  
Bot claims only `owner = 'bot'`.  
Worker claims only `owner = 'worker'`.  
The same job cannot be claimed by both.

Worker must never call the Telegram Bot API.  
Bot is not a second HTTP API for the Mini App.  
API does not process Telegram or Kick beyond ingress.

### 2.2 API process

**Accepts:** HTTPS Mini App, Admin API, health, Telegram webhook, Kick webhook.

**Does:** session/admin-session validation; read-only queries; short local commands; webhook ingress (verify → `inbound_events` → enqueue job → fast 2xx); enqueue jobs for Bot or Worker.

**Does not:** apply Telegram updates as business; apply Kick domain; refresh tokens; settle giveaways; fan-out messaging; long external I/O inside a transaction; send Telegram messages.

### 2.3 Telegram Bot process

**Accepts:** only jobs with `owner = 'bot'`.

**Does:** `telegram.process_inbound_event`; all outbound Telegram Bot API calls; calls the same `packages/domain` services as API and Worker.

**Does not:** Mini App REST; Kick OAuth/events; background settle/reconciliation; a second public HTTP API.

Bot may execute domain logic originated by Telegram (for example `/start` attribution). It must not own a second copy of rules and must not change balances outside `Wallet.apply`.

### 2.4 Worker process

**Accepts:** only jobs with `owner = 'worker'`.

**Does:** Kick apply, token refresh, subscription repair, async game settlement, giveaway close/settle, delayed rewards, notification fan-out (creates Bot jobs, does not call Telegram), wallet reconciliation, session purge.

**Does not:** Telegram Bot API; webhook ingress; Mini App HTTP.

If Worker must message a user in Telegram, it only enqueues a job with `owner=bot`.

### 2.5 Closed job-ownership matrix

| Job type | Owner | Enqueued by |
|---|---|---|
| `telegram.process_inbound_event` | bot | API ingress |
| `telegram.send_message` | bot | API, Worker, or Bot |
| `telegram.edit_message` / `telegram.answer_callback` | bot | usually Bot |
| `kick.process_inbound_event` | worker | API ingress |
| `kick.refresh_token` | worker | scheduler / command |
| `kick.repair_subscriptions` | worker | scheduler |
| `game.settle_async` | worker | API on bet accept or by event |
| `giveaway.close` / `giveaway.settle` | worker | scheduler / admin |
| `notification.fanout` | worker | domain |
| `wallet.reconcile` | worker | scheduler |
| `session.purge` | worker | scheduler |

A new job type must receive an owner at introduction. A job without owner must not be enqueued.

### 2.6 Sync vs async

**Synchronous (short DB transaction):** initData auth + session rotate; bootstrap read; section reads; local user commands (purchase, instant game, case open) when all data is already in DB; admin reads; webhook ingress persist + enqueue.

**Asynchronous (job):** Telegram update processing; Kick apply; rewards from external events; giveaway close/winner; notification fan-out; Kick token refresh; retry/dead-letter; wallet reconciliation; V1 import (one-off tool, not runtime).

### 2.7 Process failure

| Process | Lost | Kept | Double-effect protection |
|---|---|---|---|
| API | in-flight HTTP | committed events/jobs/money | client/Telegram/Kick retry + unique event |
| Bot | unfinished Telegram HTTP | job + event | stale-lock reclaim + idempotent handlers |
| Worker | unfinished handler | job | same |
| PostgreSQL | uncommitted work | committed data | backup/restore |

No critical money lives in process memory.

---

## 3. Final data / event model

### 3.1 Variant A — single `inbound_events` table

**Fixed: variant A.**  
Separate `kick_events` / `telegram_events` tables as a second raw-payload store are forbidden. One external webhook = one row.

Webhook job payload is `{ inbound_event_id }` only, not a copy of the body.

Provider-specific tables remain only for non-event state: `kick_accounts`, `kick_oauth_states`, `kick_webhook_subscriptions`, `telegram_accounts`.

### 3.2 `inbound_events`

| Field | Meaning |
|---|---|
| `id` | internal PK |
| `provider` | `telegram` \| `kick` (extensible) |
| `event_type` | provider type |
| `external_event_id` | Telegram `update_id`; Kick provider event id |
| `idempotency_key` | `{provider}:{external_event_id}` |
| `payload` | raw JSON once |
| `signature_valid` | ingress verification result |
| `received_at` | persist time |
| `processed_at` | successful apply; otherwise null |
| `processing_status` | projection: `queued` \| `processed` \| `failed` \| `dead` |
| `last_error` | last apply error |
| `job_id` | linked job |

Retry, lock, and backoff live in `jobs`, not as a second queue.  
`processing_status` and `last_error` are updated by the consumer.

**Unique:** `(provider, external_event_id)` and `idempotency_key`.

**Immutable:** `id`, `provider`, `external_event_id`, `idempotency_key`, `payload`, `received_at`.  
**Mutable:** processing status, `processed_at`, `last_error`, `job_id`.

If a provider omits a stable id, the event may be stored but must not create a money effect from weak dedup alone. Fail closed / manual review / a separate domain idempotency key. Kick id format is not invented here.

Invalid signature: no trusted apply; 4xx; security audit only.

### 3.3 Ingress transaction (short)

1. Verify secret/signature.  
2. `INSERT inbound_events`. On unique conflict, return the existing row, create no second job, HTTP 2xx.  
3. If insert is new: insert job with the correct owner and the same idempotency key.  
4. Commit. Return 2xx.

No heavy domain, no external API, no `Wallet.apply` in ingress.

### 3.4 Other logical entities

Logical names only. No schema files in Phase 0.

- `users`
- `telegram_accounts` (unique `telegram_user_id`)
- `sessions` / `admin_sessions`
- `wallets` + `wallet_transactions`
- `referral_codes`, `referrals`, `referral_events`
- `tasks`, `task_requirements`, `task_completions`
- `products`, `purchases`
- `cases`, `case_reward_items`, `case_openings`
- `games`, `game_rounds`, `game_bets`, `game_results`, `rng_draws`
- `giveaways`, `giveaway_entries`, `giveaway_winners`
- `partners`, `partner_actions`
- `kick_accounts`, `kick_oauth_states`, `kick_webhook_subscriptions`
- `notifications`
- `jobs`
- `audit_logs`
- `idempotency_keys` (HTTP POST)
- `admin_roles`, `admin_permissions`, `admin_role_permissions`, `admin_role_assignments`
- `app_config` / feature flags (small)
- `schema_migrations`

JSON is allowed only as narrow metadata, never as a store.

Money fields: `BIGINT` minor units + `currency_code`. The unit scale and currency code are **PENDING PRODUCT DECISION**.

---

## 4. Final wallet model

### 4.1 Invariants

- `wallet.balance_minor` is a materialized projection, not an independent truth.
- `wallet_transactions` is an immutable append-only ledger. Runtime `UPDATE`/`DELETE` of ledger rows is forbidden.
- Every mutation of `balance_minor` must create exactly one new ledger row in the same transaction (except wallet create at zero — below).
- Reconciliation:

```text
wallet.balance_minor
  = wallet.opening_balance_minor
  + SUM(wallet_transactions.amount_minor)
```

Credits are positive, debits negative. Reversals are ordinary applicable rows and are included in the sum.

### 4.2 Creating a normal wallet

In the same transaction as first user provision:

- `opening_balance_minor = 0`
- `balance_minor = 0`
- `version = 0`
- empty ledger

A normal new wallet always starts at 0. Welcome bonuses and any non-zero gift are not architecture facts. If product later wants a bonus, it is a separate credit with idempotency, not a runtime non-zero opening.

`opening_balance_minor` is immutable for runtime API. Only the isolated V1 importer may set it, inside an import transaction.

### 4.3 Non-zero opening on V1 import

Importer (Phase 15), not runtime.

**Snapshot mode (default contract):** set `opening_balance_minor = imported` and `balance_minor = imported`; do not copy V1 history as a store; later V2 ops use the normal ledger; reconcile as `balance = opening + sum(V2 ledger)`.

**Full-history mode (only if later chosen):** `opening_balance_minor = 0`; each imported op is a ledger row with `import:v1:{legacy_tx_id}`; `balance = sum(ledger)`. Do not set a non-zero opening and also import the same amounts into the ledger.

Runtime does not know about `store.json`.

### 4.4 `Wallet.apply` — the only balance mutation path

1. `BEGIN`  
2. `SELECT wallet FOR UPDATE`  
3. If `idempotency_key` already exists in ledger, return that row and do not change balance  
4. Debit when `balance + amount < 0` → reject; also keep `balance_minor >= 0`  
5. Frozen wallet → reject except an explicit admin policy  
6. Insert ledger row  
7. Update wallet balance and version  
8. `COMMIT`

External HTTP is before or after this transaction, never inside.

An idempotency key is mandatory for every external or replayable money action.

Logical types: `deposit`, `reward`, `referral_reward`, `purchase`, `bet`, `prize`, `refund`, `admin_adjustment`, `reversal`.  
Correction is a new row. Old financial rows are never edited.

### 4.5 Reconciliation and races

Worker job `wallet.reconcile` checks the formula. A mismatch is a P0 incident, not a raw `UPDATE` of balance. Repair is investigation plus a corrective ledger row with audit.

Double spend: row lock + balance check + unique bet/purchase key.  
Duplicate reward: key from event/task/referral.  
Retry: unique ledger key.

Amounts are not defined here.

---

## 5. Final auth model

### 5.1 Mini App

```text
Telegram initData
  → POST /auth/telegram
  → HMAC on the server
  → auth_date freshness (production: max age 1800s at session create; future skew max 60s)
  → extract telegram_user_id
  → find/create user + telegram_account + wallet(0) + referral_code
  → session rotate
  → return opaque token + expires_at
```

Later requests: `Authorization: Bearer <token>`. Server stores only `token_hash`. InitData is not a standing credential.

`GET /bootstrap` must not create a user, session, or referral, and must not require a `last_seen` write.

### 5.2 Session explosion

Plaintext tokens are not stored, so the same token cannot be re-issued after the client loses it.

**Invariant:** at most one active Mini App session per user (`revoked_at IS NULL AND expires_at > now()`).

On every successful `POST /auth/telegram`:

1. Revoke all still-active Mini App sessions for that user.  
2. Create exactly one new session.  
3. Return the new token.

This is rotation, not accumulation. Revoked history may grow; `session.purge` archives old rows (retention is operational, not economy).

The client may cache a token as a UX optimization. Security does not trust the client.

| Situation | Behavior |
|---|---|
| First login | Create user if needed + one session |
| Repeat `POST /auth` while a session is live | Revoke old + new (fresh TTL) |
| Valid Bearer, no auth call | No new session |
| `POST /auth/logout` | Revoke current |
| Expiry | 401; client must `POST /auth` with fresh initData |
| Admin block | Revoke all sessions |
| Telegram name change, same `telegram_user_id` | Update `telegram_accounts` on auth POST; same user; rotate session |
| Unexpected identity remap | Fail closed + audit. No auto-merge |

Exact session TTL and `auth_date` window: **DECIDED** — initData max age 1800s (checked only when creating a Mini App or admin session); Mini App session TTL 2_592_000s (30 days); admin session TTL 7200s (2 hours); future `auth_date` skew max 60s. Existing sessions are not re-validated against initData age.

### 5.3 Bot authentication

Ingress uses a secret path and/or `secret_token`. Identity is `telegram_user_id` → `telegram_accounts` → `users`. Deep link `/start` is handled by Bot after the durable event, not by Mini App GET. Bot token exists only on API (webhook verify) and Bot process (outbound). Never in the Web bundle.

### 5.4 Admin authentication

Separate `POST /admin/auth`. Separate `admin_sessions` (one active admin session per admin user; rotate; revoke). Shorter TTL is expected; the exact value is PENDING. Admin API requires admin session + permission. Hidden Mini App buttons are not security.

---

## 6. Final game lifecycle

Catalog field `settlement_mode`: `instant` | `async`. Concrete games and coefficients are not defined.

Client may send only intent: `game_id`, allowed bet params, `Idempotency-Key`.  
Client must never be trusted for winning number, prize, seed, probability, or final result.

### 6.1 Instant

One DB transaction after validation, no external HTTP inside the TX:

1. Lock wallet  
2. If a round with this key is already `settled`, return it  
3. Debit bet  
4. CSPRNG → `rng_draws`  
5. Pure `(config, bet, draw) → result`  
6. Prize credit if any  
7. Round `settled`  

HTTP response is the final result. Crash before commit: retry with the same key has no effect. After commit: retry returns the same round.

### 6.2 Async

**TX A — accept:** lock wallet → debit bet → round `pending` / `bet_placed` → enqueue `game.settle_async` (`owner=worker`) when settlement is internal. Response: round id + `pending`.

**TX B — settle:** if already `settled`/`voided`, no-op. Otherwise apply RNG or inbound event → result → prize → `settled`. Does not require the client to wait.

Client observes pending via read-only GET. GET must not settle.

Void/refund are separate idempotent transitions plus ledger `refund`/`reversal`.

Audit: round, bet, inbound event if any, rng_draw if any, result, tx ids, status transitions.

---

## 7. Final admin model

The system does not trust the client to declare admin, and does not hardcode Telegram IDs in architecture.

1. User exists in `users`.  
2. Active row in `admin_role_assignments`.  
3. Admin requests use an admin session from `POST /admin/auth`.

Bootstrap admins are added later by configuration/seed. IDs are not recorded here.

RBAC tables: `admin_roles` (minimum `super_admin`), `admin_permissions`, `admin_role_permissions`, `admin_role_assignments`.  
`super_admin` has all permissions. Extra roles are **PENDING PRODUCT DECISION**; the mechanism exists.

Money adjustment requires `wallet.adjust`, `reason`, `idempotency_key`, `Wallet.apply` type `admin_adjustment`, and `audit_logs` in the same transaction. Raw `UPDATE wallets.balance_minor` is forbidden.

All admin mutations write `audit_logs`.

---

## 8. Final migration strategy

Production-mandatory:

1. Migrations are forward-only in production.  
2. Application rollback = previous compatible artifact, not `DOWN`, not data drop.  
3. Schema changes:

```text
expand → deploy code that understands old + new
  → data migrate if needed
  → contract only after old code is gone
```

4. Destructive DDL is a separate safe stage.  
5. During rolling deploy, old and new code share one expanded schema.  
6. Down files are local/dev convenience only. They are not the production rollback mechanism.  
7. Concurrent migrate from several processes requires an advisory lock, or a single oneshot migrate step.

---

## 9. Final Mini App request flow

Until usable UI:

```text
[if no valid Bearer]
  1) POST /auth/telegram
  2) GET  /bootstrap
  3) render shell
  4) GET  /sections/{active}   (+ optional one non-critical prefetch)
```

Budget: at most 2 sequential + 1 parallel critical operations.  
If Bearer is still valid, skip step 1.

**In bootstrap:** public user, `balance_minor`, `currency_code`, `session.expires_at`, small flags, counters (not lists), `kick_linked` boolean, own referral code, `config_version`.

**Not in bootstrap:** catalogs, ledger, notification lists, Kick history, referral tree.

Then lazy load, cursor pagination, skeletons, timeouts, section-local degradation. GET retry is safe. POST retries must reuse the same Idempotency-Key.

---

## 10. Final webhook / job flow

### Telegram

```text
Telegram
  → API POST /telegram/webhook
  → secret_token
  → inbound_events UNIQUE (telegram, update_id)
  → job telegram.process_inbound_event owner=bot
  → 2xx
Bot claim → idempotent domain → outbound via Bot-owned jobs / Bot process
```

Duplicate `update_id`: 2xx, no second job, one business effect.

Dev long polling must persist through the same ingress-equivalent path, then the same job.

### Kick

```text
Kick → API webhook → signature
  → inbound_events UNIQUE (kick, provider_event_id)
  → job kick.process_inbound_event owner=worker
  → 2xx
Worker → domain
```

OAuth start is POST. Callback consumes `kick_oauth_states` once. Code-to-token exchange is outside any money transaction.

Chat presence is not watch time. Proof rule is PENDING.

### Jobs

PostgreSQL + `SKIP LOCKED`.  
States: `pending` → `processing` → `completed` | retryable `failed` → `pending` with `next_attempt_at` | `dead`.

Fields include `owner`, `type`, unique `(type, idempotency_key)`, retry metadata, lock metadata.

Exponential backoff with jitter. Stale-lock reclaim. Handlers must be idempotent.

Redis is not required in stage 1. Domain depends on a queue port, not on Redis.

---

## 11. Security and idempotency rules

1. PostgreSQL is the only source of truth.  
2. GET and health perform no writes and no rewards.  
3. One external event → one `inbound_events` row → at most one successful apply.  
4. Every money effect has a unique ledger idempotency key.  
5. Mutating HTTP POST uses `Idempotency-Key` where the response must be replayable.  
6. Games are idempotent; the client does not set the result.  
7. Bot and Worker never share job ownership.  
8. Worker never calls Telegram API.  
9. No critical external HTTP inside a money/domain DB transaction.  
10. Rate limiter is a port; stage 1 may be in-memory per process. It does not replace idempotency.  
11. Secrets are not in the client or in logs.  
12. Structured logs carry `request_id`, `correlation_id`, `event_id`, `job_id`.  
13. Admin money = identity + reason + ledger + audit.  
14. Live ≠ ready. Ready is a read-only `SELECT 1`.  
15. V1 importer is isolated, read-only toward V1, dry-run + reconciliation.

Mutations use `POST` / `PATCH` / `DELETE` or a job created from a write path.

---

## 12. Pending product decisions

See [`docs/architecture/PENDING_PRODUCT_DECISIONS.md`](docs/architecture/PENDING_PRODUCT_DECISIONS.md).  
Do not treat those items as architecture facts and do not invent values.

---

## 13. Phases

See [`docs/architecture/PHASES.md`](docs/architecture/PHASES.md).  
Phase 0 records this architecture. Phase 1+ starts only after an explicit command.

---

## 14. Final architecture checklist

- [x] PostgreSQL only source of truth
- [x] no store.json
- [x] GET read-only
- [x] mutations only via POST/PATCH/DELETE or jobs from write-path
- [x] wallet ledger + projection + `opening_balance_minor`
- [x] new wallet starts at 0
- [x] V1 non-zero opening only via importer, no double count
- [x] wallet idempotency + `FOR UPDATE`
- [x] reversals = new rows, no edit of old ledger
- [x] Telegram auth + hashed opaque session
- [x] session rotation, no active-session explosion
- [x] Mini App staged startup, small bootstrap
- [x] inbound_events unified (variant A), no duplicate payload store
- [x] Telegram ingress durable; Bot is sole Telegram API client
- [x] Kick ingress durable; Worker applies Kick
- [x] job `owner` exclusive (bot vs worker)
- [x] Worker never calls Telegram API
- [x] Bot is not a second Mini App API
- [x] SKIP LOCKED + retry + dead + stale reclaim
- [x] instant vs async game lifecycles
- [x] CSPRNG + game audit + client cannot set result
- [x] admin RBAC + `super_admin` + admin session
- [x] admin money = reason + ledger + audit
- [x] rate limiter port (memory first, no Redis required)
- [x] no critical external HTTP inside DB transactions
- [x] observability + live/ready
- [x] load testing required before prod-ready
- [x] expand/contract migrations; no destructive prod down-rollback
- [x] backup/restore + application rollback
- [x] isolated V1 importer
- [x] modular monolith, independently scalable processes, host-agnostic
- [x] pending product decisions explicitly separated

Checkboxes above mean **architecturally decided**, not implemented in code.

---

## 15. Contradiction review (unchanged)

| Risk | Status |
|---|---|
| GET writes | Forbidden |
| Duplicate Telegram/Kick payload stores | Forbidden; only `inbound_events` |
| Bot and Worker claim the same update | Forbidden via `owner` + unique keys |
| Worker sends Telegram | Forbidden |
| Bot is a second API | Forbidden |
| Session explosion | Forbidden; one active Mini App session via rotate |
| Hash-only reuse of the same token | Not promised; active sessions do not accumulate |
| Wallet 0 vs import | Runtime 0; import opening is a separate non-double-count rule |
| Instant always shares a TX with async | No; async is split; GET does not settle |
| Down migration as prod rollback | Forbidden |
| Redis required | No |
| V1 in runtime | No |
| Watch-time / referral activation as facts | No; pending |

---

## 16. Phase 0 scope statement

This document is an architecture record.  
It is not a database schema, not an API, not a bot, not a worker, not a Mini App, and not an importer.

No product amounts, probabilities, activation rules, or Kick watch-time proofs are chosen here.
