# AZAROV GiftBot V2 — production deployment runbook

Document-only runbook for a **controlled parallel V2 install** on a Linux VPS.
This file does **not** authorize or perform deployment. Closing architecture phases does **not** claim the product is production-ready.

Canonical related docs:

- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Phase gates: [`docs/architecture/PHASES.md`](docs/architecture/PHASES.md)
- Pending product decisions: [`docs/architecture/PENDING_PRODUCT_DECISIONS.md`](docs/architecture/PENDING_PRODUCT_DECISIONS.md)
- In-tree deploy templates (Phase 14): [`deploy/README.md`](deploy/README.md)

**Out of scope for this stage (do not run from this document alone):**

- Touching V1 at `/var/www/AZAROV-GiftBot`
- Switching production Telegram or Kick webhooks without an explicit cutover window
- Running `tools/v1-importer`
- Destructive PostgreSQL down-migrations
- Committing or pasting real secrets

---

## 1. First-deployment philosophy

Future first production cutover is **staged**. Keep V1 intact as fallback until V2 is observed healthy.

| Step | Action | Cutover? |
|---|---|---|
| A | Install V2 **alongside** V1 (separate tree, units, DB or schema, env) | No |
| B | Provision PostgreSQL 16+ for V2 | No |
| C | Forward-only migrate (`pnpm db:migrate` / migrate oneshot) | No |
| D | Start API + Worker (and Bot if needed) without public Telegram/Kick cutover | No |
| E | Local VPS health checks (`/health/live`, `/health/ready`) | No |
| F | Nginx + HTTPS (+ WSS upgrade) for V2 host/path | Partial (HTTP only) |
| G | Controlled Telegram webhook + Kick Events ingress cutover | **Yes — one consumer each** |
| H | Smoke checklist (below) | After G |
| I | Observation window (errors, queues, locks, RSS) | After H |
| J | Keep V1 untouched temporarily; retire only after explicit decision | — |

Never run V1 and V2 Telegram consumers on the **same bot token** at the same time.
Never point two authoritative Kick Event destinations at conflicting writers for the same channel/app.

---

## 2. Prerequisites

| Component | Requirement |
|---|---|
| OS | Linux VPS (systemd + nginx) |
| Node | **22 LTS** (`node -v` → `v22.x`) |
| Package manager | **pnpm 10.15.1** via `npm exec --yes -- pnpm@10.15.1 …` |
| Database | **PostgreSQL 16+** (V2-owned database; not V1 `store.json`) |
| Reverse proxy | nginx with TLS termination |
| TLS | Valid certificates for the public Mini App / API host |
| Process isolation | Three Node processes: **API**, **Worker**, **Bot** — never merged |
| Web | Static `apps/web/dist` only (not a fourth Node unit) |

Host toolchain check (illustrative):

```bash
node -v                    # expect v22.x
psql --version             # expect 16+
npm exec --yes -- pnpm@10.15.1 -v   # expect 10.15.1
```

---

## 3. Parallel install vs V1

| Path / concern | Rule |
|---|---|
| V1 tree | `/var/www/AZAROV-GiftBot` — **do not modify** for V2 |
| V2 tree | Recommended: `/var/www/AZAROV-GiftBot-V2` **or** `/opt/azarov-giftbot-v2` |
| V2 secrets | `/etc/azarov-giftbot/env` (mode `0600`, not in git) |
| V2 uploads | `/var/lib/azarov-giftbot/uploads` (outside release tree) |
| V2 backups | e.g. `/var/backups/azarov-giftbot` |
| systemd / nginx names | Existing templates use `giftbot-*` under `/opt/giftbot`. For a true parallel install next to V1, prefer conceptual **`azarov-v2-*`** unit/site names and adjust `WorkingDirectory` / `EnvironmentFile` / `root` paths accordingly. Do not overwrite V1 units. |

In-tree Phase 14 templates (`deploy/`) use:

```text
/opt/giftbot/releases/<id>
/opt/giftbot/current          → symlink
/etc/giftbot/env
/etc/giftbot/tls
/var/backups/giftbot
```

Operators may keep those paths **or** map them 1:1 onto the recommended `azarov-giftbot` layout. Either way: **one V2 release root, one V2 env file, V1 left alone.**

---

## 4. Recommended directory layout

```text
# Application (choose one root)
/var/www/AZAROV-GiftBot-V2/          # or /opt/azarov-giftbot-v2/
  releases/<release-id>/             # built monorepo (pnpm install + build)
  current -> releases/<release-id>   # active artifact symlink
  shared/                            # optional non-secret shared files

# Host config (not in git)
/etc/azarov-giftbot/env              # EnvironmentFile for systemd
/etc/azarov-giftbot/tls/             # fullchain.pem, privkey.pem (or ACME paths)

# Persistent data outside releases
/var/lib/azarov-giftbot/uploads/     # Welvura screenshots; private
/var/backups/azarov-giftbot/         # pg_dump custom-format files

# V1 (untouched)
/var/www/AZAROV-GiftBot/
```

Create layout with adapted `deploy/install-layout.sh` (set `GIFTBOT_ROOT` / paths) or equivalent `install -d`. Create a dedicated system user (templates use `giftbot`) that owns the release tree and can read the env file.

---

## 5. Auth / session policy (frozen)

Product decision #9 — do **not** invent alternate TTLs for first deploy. Defaults live in `@giftbot/auth`.

| Window | Value | Notes |
|---|---|---|
| Telegram initData max age | **1800s** (30 min) | Checked **only at session create** (Mini App or admin) |
| Mini App session TTL | **2_592_000s** (30 days) | Opaque hashed token; not re-checked against initData age |
| Admin session TTL | **7200s** (2 hours) | Intentionally shorter |
| Future `auth_date` skew | **60s** | Reject if `auth_date` is more than 60s ahead of server clock |

Optional env overrides exist (`AUTH_INIT_DATA_MAX_AGE_SECONDS`, `AUTH_SESSION_TTL_SECONDS`, `AUTH_ADMIN_SESSION_TTL_SECONDS` and aliases) but first production should leave them **unset** unless operations explicitly change policy.

`ALLOW_DEV_AUTH=true` is **forbidden** when `NODE_ENV=production` (fail-fast).

---

## 6. Environment contract (names only — no secrets)

Copy [`deploy/env/giftbot.env.example`](deploy/env/giftbot.env.example) to `/etc/azarov-giftbot/env` (or `/etc/giftbot/env`) and fill on the host. **Never commit a filled copy.**

### 6.1 Always set for production runtime

| Variable | Role |
|---|---|
| `NODE_ENV` | Must be `production` |
| `LOG_LEVEL` | e.g. `info` |
| `DATABASE_URL` | PostgreSQL URL for V2 |
| `API_HOST` / `API_PORT` | Default `127.0.0.1` / `3000` |
| `BOT_HEALTH_HOST` / `BOT_HEALTH_PORT` | Default `127.0.0.1` / `3001` |
| `WORKER_HEALTH_HOST` / `WORKER_HEALTH_PORT` | Default `127.0.0.1` / `3002` |
| `TELEGRAM_BOT_TOKEN` | Required for API + Bot with DB |
| `TELEGRAM_BOT_USERNAME` | Required for production API (referral deep links) |
| `TELEGRAM_WEBHOOK_SECRET` | Required for production API; Telegram header check |
| `TELEGRAM_LONG_POLLING` | Must be `false` (or unset) in production |
| `PUBLIC_BASE_URL` | Public HTTPS origin, no trailing slash |
| `UPLOAD_DIR` | Absolute path, e.g. `/var/lib/azarov-giftbot/uploads` |

### 6.2 Kick OAuth (all-or-nothing)

If any Kick OAuth var is set, **all four** are required or API fail-fasts:

- `KICK_CLIENT_ID`
- `KICK_CLIENT_SECRET`
- `KICK_REDIRECT_URI`
- `KICK_TOKEN_ENCRYPTION_KEY` (64 hex chars)

**Do not set `KICK_WEBHOOK_SECRET`.** Kick Events verify `Kick-Event-Signature` with Kick’s RSA public key (`https://api.kick.com/public/v1/public-key`, process-memory cache).

### 6.3 Optional / operational

| Variable | Notes |
|---|---|
| `TRUST_PROXY` | Behind one nginx hop: `1` |
| `CORS_ORIGINS` | Empty = same-origin (typical when nginx serves web + API) |
| `DB_POOL_MAX` | Overrides role default (see §8) |
| `DB_CONNECT_TIMEOUT_SECONDS` | Default 10 |
| Rate-limit overrides | Only if operations change defaults |

### 6.4 Never in production

- `ALLOW_DEV_AUTH=true`
- `TELEGRAM_LONG_POLLING=true`
- Real secrets in git, PR bodies, or this markdown file

Fail-fast helper: `assertProductionRuntimeEnv` in `@giftbot/config` (API/Bot/Worker boot).

---

## 7. Install and build

On a build host or the VPS (Node 22):

```bash
cd /path/to/release-source
npm exec --yes -- pnpm@10.15.1 install
npm exec --yes -- pnpm@10.15.1 build
```

Place the built tree under `releases/<id>` and point `current` at it:

```bash
ln -sfn /var/www/AZAROV-GiftBot-V2/releases/<id> /var/www/AZAROV-GiftBot-V2/current
```

Ensure `node` can resolve `apps/*/dist` and `packages/db/dist` from `WorkingDirectory=…/current`.

Local validation commands (pre-VPS) remain:

```bash
npm exec --yes -- pnpm@10.15.1 check
npm exec --yes -- pnpm@10.15.1 lint
npm exec --yes -- pnpm@10.15.1 validate
```

---

## 8. PostgreSQL pools and connection budget

Defaults in `@giftbot/config` (`DEFAULT_DB_POOL_MAX`), overridable per process via `DB_POOL_MAX`:

| Process | Default `DB_POOL_MAX` |
|---|---|
| API | **20** |
| Worker | **10** |
| Bot | **5** |

**Steady runtime budget ≈ 20 + 10 + 5 = 35** connections, plus headroom for:

- Migrate oneshot (brief)
- `psql` / backup / restore / ops
- Optional admin tooling

Size PostgreSQL `max_connections` (and any pooler) so that **≥ 35 + migrate/ops reserve** (env example notes ≈ 35 + migrate reserve). Do not run multiple API replicas each with pool 20 without raising the budget intentionally.

Connect timeout default: **10s** (`DB_CONNECT_TIMEOUT_SECONDS`).

---

## 9. Migrations

Forward-only expand/contract. **Never** use down-migration as rollback.

Production path:

1. `DATABASE_URL` set in env file
2. Oneshoot migrate **before** (or via `Wants=` before) runtime units:

```bash
# From release current, with env loaded:
npm exec --yes -- pnpm@10.15.1 db:migrate
# or:
node packages/db/dist/migrate.js
```

systemd template: [`deploy/systemd/giftbot-migrate.service`](deploy/systemd/giftbot-migrate.service) (`Type=oneshot`, `RemainAfterExit=yes`).

Concurrent migrate uses advisory lock `872_514`; the oneshot unit is still the production path. App rollback is a **previous compatible artifact**, not `drizzle-kit drop` / `DOWN`.

---

## 10. Processes

| Process | Entry | Public HTTP | Jobs |
|---|---|---|---|
| **API** | `node apps/api/dist/main.js` | nginx → `127.0.0.1:3000` | Does not own Bot/Worker exclusive queues as those owners |
| **Bot** | `node apps/bot/dist/main.js` | localhost health `3001` only | `owner=bot` only; **may** call Telegram Bot API |
| **Worker** | `node apps/worker/dist/main.js` | localhost health `3002` only | `owner=worker` only; **never** calls Telegram Bot API |
| **Web** | static files | nginx `root …/apps/web/dist` | n/a |

Invariants:

- PostgreSQL is the only source of truth (no `store.json`, no Redis in stage 1).
- GET is read-only; money only via `Wallet.apply` (ledger + `FOR UPDATE` + idempotency).
- One inbound webhook body → `inbound_events` (variant A), then jobs.
- Bot is **not** a Mini App HTTP API.
- Worker never talks to Telegram.

Production Telegram uses **webhooks on the API**. Leave long polling off.

---

## 11. systemd plan

### 11.1 In-tree templates (reference)

| Unit file | Purpose |
|---|---|
| [`deploy/systemd/giftbot-migrate.service`](deploy/systemd/giftbot-migrate.service) | Forward migrate oneshot |
| [`deploy/systemd/giftbot-api.service`](deploy/systemd/giftbot-api.service) | API |
| [`deploy/systemd/giftbot-bot.service`](deploy/systemd/giftbot-bot.service) | Bot |
| [`deploy/systemd/giftbot-worker.service`](deploy/systemd/giftbot-worker.service) | Worker |

Templates expect `EnvironmentFile=/etc/giftbot/env` and `WorkingDirectory=/opt/giftbot/current`.

Enable migrate + three runtime units independently. Do **not** merge `ExecStart` lines.

### 11.2 Conceptual parallel naming (`azarov-v2-*`)

When V1 already occupies generic names on the host, install copies as e.g.:

| Conceptual unit | Maps to template |
|---|---|
| `azarov-v2-migrate.service` | giftbot-migrate |
| `azarov-v2-api.service` | giftbot-api |
| `azarov-v2-bot.service` | giftbot-bot |
| `azarov-v2-worker.service` | giftbot-worker |

Adjust `EnvironmentFile=/etc/azarov-giftbot/env`, `WorkingDirectory` to the V2 `current` symlink, and documentation paths. Keep V1 units untouched.

Example start order after a release that needs schema expand:

```bash
systemctl start azarov-v2-migrate.service   # or giftbot-migrate.service
systemctl start azarov-v2-api.service
systemctl start azarov-v2-worker.service
systemctl start azarov-v2-bot.service
```

Artifact restart (no migrate): restart the three runtime units only. See [`deploy/rollback.sh`](deploy/rollback.sh) (refuses `down` / `migrate` arguments).

---

## 12. Nginx, HTTPS, and WSS

### 12.1 In-tree template

[`deploy/nginx/giftbot.conf`](deploy/nginx/giftbot.conf) + [`deploy/nginx/proxy_params`](deploy/nginx/proxy_params):

- Port 80 → ACME challenge + redirect to HTTPS
- Port 443 → TLS; `root` = `…/current/apps/web/dist`
- Proxy Mini App/API/webhook prefixes to `127.0.0.1:3000` only
- **Do not** proxy Mini App routes to Bot or Worker

Proxied prefixes include: `/auth/`, `/admin/`, `/bootstrap`, `/sections/`, `/kick/`, `/games/`, `/rounds/`, `/cases/`, `/products/`, `/tasks/`, `/referrals/`, `/telegram/`, `/health/`.

### 12.2 HTTPS / WSS requirements

- Public Mini App and API must be **HTTPS**.
- Rolls realtime uses same host: `wss://<host>/games/rolls/ws?token=…` when the page is HTTPS.
- Ensure nginx WebSocket upgrade headers on the `/games/` (or WS) location, e.g. `Upgrade` / `Connection` — the stock `proxy_params` forwards identity headers; operators must confirm WS upgrade works before cutover.
- Set `TRUST_PROXY=1` when nginx terminates TLS.
- `PUBLIC_BASE_URL=https://your-v2-host` (no trailing slash).
- Frontend uses **same-origin relative** `fetch` / `WebSocket` — no VITE secrets required for API base in the static build.

TLS material lives on the host (`/etc/azarov-giftbot/tls/` or ACME paths), **not in git**.

For parallel V1/V2, use a distinct `server_name` / cert for V2 until cutover, or a dedicated path/host plan that does not hijack V1 traffic accidentally.

---

## 13. Health checks

| Endpoint | Meaning |
|---|---|
| `GET /health/live` | Process up (no DB write) |
| `GET /health/ready` | Read-only readiness (`SELECT 1`); **503** without DB |

API (via nginx):

```bash
curl -fsS https://<v2-host>/health/live
curl -fsS https://<v2-host>/health/ready
```

Bot / Worker (localhost only):

```bash
curl -fsS http://127.0.0.1:3001/health/live
curl -fsS http://127.0.0.1:3002/health/live
# ready equivalents on the same health ports when DATABASE_URL is set
```

`live ≠ ready`. Never treat live as proof the database is reachable.

---

## 14. Webhooks

### 14.1 Telegram

- **Route:** `POST /telegram/webhook`
- **Auth:** header `X-Telegram-Bot-Api-Secret-Token` must match `TELEGRAM_WEBHOOK_SECRET`
- Without secret configured, Telegram POSTs are rejected (**503**)
- Persist inbound body → `inbound_events`, then process via jobs (idempotent)

Set webhook only during cutover (§16), pointing at the **V2** HTTPS URL.

### 14.2 Kick

- **Route:** `POST /kick/webhook`
- **Auth:** RSA `Kick-Event-Signature` verification (Kick public key) — **not** a shared webhook secret
- Raw body required for signature verification
- Duplicate / idempotent handling via durable inbound storage

Point Kick Events at **one** authoritative V2 ingress during cutover (§17).

---

## 15. Uploads (private)

| Setting | Value |
|---|---|
| Env | `UPLOAD_DIR=/var/lib/azarov-giftbot/uploads` |
| Placement | Outside release tree; survive artifact rollback |
| Public nginx | **Do not** `alias` / `root` this directory |
| Access | Authenticated admin API only, e.g. `GET /admin/welvura/files/:fileId` (`cache-control: private, no-store`) |

Create the directory owned by the runtime user before starting API.

---

## 16. Super-admin bootstrap

Migrations seed the **`super_admin` role name** only — **not** Telegram user IDs and **not** `admin_role_assignments`.

After a real operator opens the Mini App once (user row exists):

1. Resolve `users.id` for that Telegram account.
2. Insert an `admin_role_assignments` row linking that user to the `super_admin` role id.
3. Operator authenticates via `POST /admin/auth` with fresh initData.

Illustrative SQL (placeholders only — no real IDs in git):

```sql
-- After Mini App provision created the user:
INSERT INTO admin_role_assignments (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN telegram_accounts t ON t.user_id = u.id
JOIN admin_roles r ON r.name = 'super_admin'
WHERE t.telegram_user_id = <TELEGRAM_USER_ID>
ON CONFLICT DO NOTHING;  -- adjust to actual unique constraints if present
```

Revoke by deleting the assignment. Mini App tokens cannot call admin routes.

---

## 17. Telegram cutover plan (safety)

**Hard rule:** never run V1 and V2 as concurrent consumers of the **same** `TELEGRAM_BOT_TOKEN`.

Suggested sequence:

1. V2 API healthy (`/health/ready`), migrate applied, Bot unit ready to drain `owner=bot` jobs.
2. Confirm V2 `TELEGRAM_WEBHOOK_SECRET` matches what you will register with Telegram.
3. Stop or disable V1 Telegram consumer / clear V1 webhook (V1-specific — do not document V1 internals here; coordinate ops).
4. `setWebhook` to `https://<v2-host>/telegram/webhook` with the secret token header configured.
5. Send a test message / `/start`; confirm `inbound_events` + Bot job progress.
6. If broken: restore webhook to V1 **before** restarting V1 consumer — still only one consumer.

Leave `TELEGRAM_LONG_POLLING=false` on V2 production.

---

## 18. Kick cutover plan (safety)

**Hard rule:** one authoritative Events ingress for the production Kick app/channel.

1. V2 Kick OAuth env complete; API ready; Worker ready for Kick durable events.
2. Register / switch Kick Events URL to `https://<v2-host>/kick/webhook`.
3. Verify signature path with a test event (LIVE/OFFLINE / chat as applicable).
4. Do not leave V1 and V2 both applying the same Kick stream as writers.

OAuth redirect URI must match `KICK_REDIRECT_URI` and HTTPS `PUBLIC_BASE_URL` plan.

---

## 19. Rollback to V1 (without destructive PG down-migration)

Documented for future use — **do not execute** as part of writing this file.

Because V1 remains the fallback:

1. **Stop V2 public consumers:** disable V2 Telegram webhook consumption; stop or isolate V2 Kick Events destination.
2. **Restore routing to V1** where DNS/nginx/webhook URLs previously pointed (Telegram `setWebhook`, Kick Events URL, Mini App URL if switched).
3. **Ensure only one Telegram consumer** is active on the shared token.
4. **Do not** “reverse migrate” V2 PostgreSQL with destructive `DOWN` files to undo expand DDL. Leave the V2 database in place for forensics or later retry; V1 continues on its own store.
5. Stop V2 runtime units if they should not keep writing (`systemctl stop` API/Bot/Worker). Migrate oneshot is not a rollback tool.

Application-level V2 rollback (stay on V2, previous build) is separate: [`deploy/rollback.sh`](deploy/rollback.sh) retargets `current` and restarts the three runtime units — still **no** down-migration.

---

## 20. Backup and restore

Scripts (adapt env path / backup dir for azarov layout):

| Script | Purpose |
|---|---|
| [`deploy/backup/backup.sh`](deploy/backup/backup.sh) | `pg_dump --format=custom` |
| [`deploy/backup/restore.sh`](deploy/backup/restore.sh) | `pg_restore` into `GIFTBOT_RESTORE_DATABASE_URL` |

Rules:

- Back up **before** cutover and on a schedule after go-live.
- Restore into an empty/replacement database URL; do not casually restore onto a live writer.
- Prove recovery (drill) before trusting cutover. Repo drills: `pnpm db:restore-drill`, `pnpm db:backup-restore-drill`.
- Backup is not a down-migration; restore scripts refuse `down` arguments.

---

## 21. Log locations

| Source | Where |
|---|---|
| systemd journals | `journalctl -u giftbot-api` (or `azarov-v2-api`) etc. |
| Structured app logs | stdout/stderr from Node units (correlation ids; secrets redacted per Phase 12) |
| nginx access/error | host nginx log paths |
| PostgreSQL | host PG log configuration |

Prefer correlation / request ids from API logs when tracing webhook → job → ledger.

---

## 22. V1 importer (not this stage)

| Item | Status |
|---|---|
| Tool | `tools/v1-importer` CLI only (`@giftbot/v1-importer`) |
| Runtime | API / Bot / Worker / Web **do not** import |
| This stage | **Do not run** importer during first parallel install / cutover unless a separate Phase 15 ops plan says so |
| Input | `giftbot-v1-export` file; rejects raw `store.json` as runtime store |

---

## 23. Known task verification limitations

Built-in tasks that currently cannot auto-verify in production without prior evidence / fixtures:

| Task code | Production status | Behavior |
|---|---|---|
| `kick_follow_azarov7777` | **BLOCKER / LIMITED** | No Kick Follow API adapter. Claim → `verification_unavailable`. Do not trust a client button. |
| `telegram_subscribe_azarov222` | **BLOCKER / LIMITED** | `getChatMember` for `@azarov222` is **not wired**. Claim → `verification_unavailable`. |

Other tasks (nickname tag, Kick link, bot started, referral_3_active, Welvura flows) follow their implemented evidence paths. Do not invent verification adapters in a deploy window.

### Kick token refresh (runtime)

Worker owns `kick.refresh_token`. When Kick OAuth env is configured, the Worker idle loop periodically enqueues refresh jobs for active accounts whose `token_expires_at` is null or within a lead window (`KICK_REFRESH_LEAD_SECONDS`, default 600). Permanent Kick token HTTP failures (400/401/403) set account status `needs_reauth` and clear ciphertext (no infinite retry hot-loop). Tokens remain AES-256-GCM at rest; never exposed to the Mini App frontend.

---

## 24. Smoke checklist (post-cutover)

Run only after intentional Telegram/Kick cutover (or on a staging host with non-production tokens).

- [ ] `GET /health/live` → 200
- [ ] `GET /health/ready` → 200
- [ ] Mini App static loads over **HTTPS**
- [ ] `POST /auth/telegram` with real initData creates session (initData ≤ 1800s)
- [ ] `GET /bootstrap` (authenticated) returns staged payload
- [ ] Bot health localhost live/ready; Bot drains `owner=bot` jobs
- [ ] Worker health localhost live/ready; Worker drains `owner=worker` jobs
- [ ] Telegram: test update hits `POST /telegram/webhook` with secret header; idempotent replay safe
- [ ] Kick: test event hits `POST /kick/webhook` with valid signature (if Kick enabled)
- [ ] Rolls: `wss://` connects on `/games/rolls/ws`
- [ ] Admin: after assignment, `POST /admin/auth` works; Mini App token rejected on admin routes
- [ ] Upload dir exists; admin file fetch works; nginx does **not** serve uploads publicly
- [ ] Wallet / ledger spot-check: no negative balances invented by deploy
- [ ] Confirm V1 tree untouched; only one Telegram consumer on the token
- [ ] `kick_follow_azarov7777` / `telegram_subscribe_azarov222` show `verification_unavailable` as expected (not a deploy failure)

---

## 25. Load-test findings (local reference — not SLA)

Phase 13 / extended local harness results are **non-contractual**. They do **not** define production SLOs and do **not** claim production-ready.

Illustrative local findings (Windows + embedded Postgres / production-like in-process API; see `tools/loadtest` reports such as `FULL3_REPORT.out`, `CONTINUE_REPORT.json`):

| Scenario (local) | Concurrency | Notes |
|---|---|---|
| Home startup ladder | 15→200 | Local knee roughly **100→200** concurrent (p95 rises sharply) |
| Home @50 (continue, post-seed) | 50 | Cold-ish p95 ~seconds observed once; warm FULL3 was much lower — treat as cold-cache / harness artifact unless reproduced on VPS |
| Rolls join | **1000** | 1000×200 locally after pool/pre-create; invariants 0 |
| Rolls WebSocket | 50 / 100 / **200** | Open + first message OK locally |
| Mixed load | 50×180s | ~50.7k requests locally; 0 HTTP errors in harness report |
| Promo final-slot race | 50 | Exactly **1** success |
| Invariants | — | Wallet / Rolls pot / multi-winner / promo dups: **0** |
| Bot backlog | — | Synthetic webhook spam can leave a small Bot backlog after 30s; Bot continues draining independently (API does not wait on send) |

Harness may override rate limits because one shared IP would hit default caps — that override is **not** a production setting.
Local numbers ≠ VPS capacity.

---

## 26. Operator quick reference

```text
# Build
npm exec --yes -- pnpm@10.15.1 install
npm exec --yes -- pnpm@10.15.1 build

# Migrate (oneshot, before writers if schema changed)
npm exec --yes -- pnpm@10.15.1 db:migrate
# or: node packages/db/dist/migrate.js

# Runtime (via systemd preferred)
node apps/api/dist/main.js
node apps/worker/dist/main.js
node apps/bot/dist/main.js

# Health
curl -fsS https://<host>/health/live
curl -fsS https://<host>/health/ready

# Backup
deploy/backup/backup.sh

# V2 artifact rollback (not V1 cutback, not DOWN)
deploy/rollback.sh
```

---

## 27. Related template index

| Path | Use |
|---|---|
| [`deploy/README.md`](deploy/README.md) | Short Phase 14 summary |
| [`deploy/install-layout.sh`](deploy/install-layout.sh) | Host directories |
| [`deploy/env/giftbot.env.example`](deploy/env/giftbot.env.example) | Env names |
| [`deploy/systemd/*.service`](deploy/systemd/) | Process units |
| [`deploy/nginx/giftbot.conf`](deploy/nginx/giftbot.conf) | API + static |
| [`deploy/backup/*.sh`](deploy/backup/) | pg_dump / pg_restore |
| [`deploy/rollback.sh`](deploy/rollback.sh) | Previous release symlink |

End of runbook. **Document only — do not deploy from this file without an explicit ops decision.**
