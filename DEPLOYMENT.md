# AZAROV GiftBot — Deployment Guide (Railway)

This project is a Telegram Mini App (React/Vite) + Express API + Telegraf bot
with a JSON file store. This guide covers local development and Railway production.

Do **not** commit secrets, `.env`, `server/data/*` (except `.gitkeep`), or `uploads/`.

---

## 1. Install dependencies

```bash
npm install
```

---

## 2. Local development

1. Copy `.env.example` → `.env` and fill at least `BOT_TOKEN` / `BOT_USERNAME` if you need the bot.
2. Start API + bot + Vite:

```bash
npm run dev
```

- Mini App (Vite): `http://127.0.0.1:5173`
- API: `http://127.0.0.1:3001` (Vite proxies `/api` → API)

Useful separate commands:

```bash
npm run server      # Express only
npm run bot         # Telegram bot only (long polling)
npm run server:dev  # Express with --watch
npm run bot:dev     # Bot with --watch
```

---

## 3. Production build

```bash
npm run build
```

This runs TypeScript check (`tsc -b`) and Vite build into `dist/`.
Do not commit `dist/`.

---

## 4. Environment variables

| Variable | Required (prod) | Purpose |
|----------|-----------------|---------|
| `BOT_TOKEN` | yes | Telegram bot token |
| `BOT_USERNAME` | yes (for referral links) | Bot username without `@` |
| `REFERRAL_REWARD` | optional | Coins for both sides when invitee links Kick (default `1000`) |
| `WEBAPP_URL` | yes | Public HTTPS URL of the Mini App |
| `TELEGRAM_CHANNEL` | recommended | Channel for subscribe task (`@azarov222`). Bot must be an **administrator** of this channel so `getChatMember` works. |
| `KICK_CLIENT_ID` | for Kick link | Kick OAuth client id |
| `KICK_CLIENT_SECRET` | for Kick link | Kick OAuth client secret (server only) |
| `KICK_REDIRECT_URI` | for Kick link | Exact callback URL registered in Kick Developer settings |
| `KICK_REQUIRED_CHANNEL` | for Kick follow task | Channel slug to follow (default `azarov7777`) |
| `PORT` | set by Railway | HTTP listen port |
| `HOST` | optional | Default `0.0.0.0` |
| `NODE_ENV` | yes (`production`) | Enables production checks |
| `CORS_ORIGINS` | optional if `WEBAPP_URL` set | Extra allowed origins |
| `ADMIN_API_KEY` | yes (≥ 32 chars) | Admin moderation header |
| `ADMIN_TELEGRAM_IDS` | recommended | Telegram user IDs for bot Approve/Reject |
| `ADMIN_CHAT_ID` | optional | Chat/group for partner submission photos |
| `AZAROV_STORE_DIR` | **required on Railway** | JSON store directory (Volume) |
| `AZAROV_UPLOADS_DIR` | **required on Railway** | Uploads base directory (Volume) |
| `VITE_API_URL` | leave empty | Same-origin `/api` in production |

See `.env.example` for comments.

### WEBAPP_URL

Public HTTPS URL of your deployed app, e.g. `https://your-service.up.railway.app`.

Used for:

- Telegram WebApp button on `/start`
- CORS allowlist (origin derived from this URL)

### CORS_ORIGINS

Comma-separated allowed browser origins. If empty, the origin of `WEBAPP_URL` is used.
In development, localhost Vite origins are allowed when both are empty.
Do **not** use `*` in production.

### ADMIN_API_KEY

Secret for admin partner-submission endpoints (`X-Admin-Key`).
Generate a long random string (≥ 32 characters). Never commit the real value.

### ADMIN_TELEGRAM_IDS

Comma-separated Telegram **user** IDs allowed to press Approve/Reject on partner (Welvura) submission messages in the bot. Get an ID via `@userinfobot`.

Without this, submissions still work in Mini App + HTTP admin API, but Telegram buttons will deny non-listed users.

### ADMIN_CHAT_ID

Optional chat/group ID where new partner submissions (text + screenshot + buttons) are posted. If empty, each `ADMIN_TELEGRAM_IDS` user is DMed instead.

### AZAROV_STORE_DIR

Directory for `store.json` (and lock/temp/backup files).

- Local default: `server/data` (fine for local only — wiped on Railway redeploy)
- Railway **required**: `/data` → `/data/store.json` (+ `.bak` backups)

Without a Volume, production boot **exits** (unless `AZAROV_ALLOW_EPHEMERAL_STORE=1`).

### AZAROV_UPLOADS_DIR

Base directory for partner screenshots.

- Local default: `<project>/uploads`
- Railway **required**: `/data/uploads` → files in `/data/uploads/partner-submissions/`

Relative screenshot paths in the store stay `partner-submissions/<id>.<ext>` (unchanged).

---

## 5. Railway Variables

Set these in Railway → Variables (no secrets in git):

```text
BOT_TOKEN=
BOT_USERNAME=
WEBAPP_URL=
TELEGRAM_CHANNEL=
NODE_ENV=production
CORS_ORIGINS=
ADMIN_API_KEY=
AZAROV_STORE_DIR=/data
AZAROV_UPLOADS_DIR=/data/uploads
HOST=0.0.0.0
```

`PORT` is provided by Railway automatically.

Leave `VITE_API_URL` unset so the frontend calls `/api/*` on the same domain.

---

## 6. Build & Start commands (Railway)

**Build Command:**

```bash
npm run build
```

**Start Command:**

```bash
npm run start:production
```

(`npm start` is the same launcher. `railway.toml` also pins this command.)

This starts:

1. Express API on `HOST:PORT`
2. Serves `dist/` for the Mini App (same domain)
3. Telegram Bot via long polling (single instance)

Do **not** also run `npm run start:bot` in a second service — two bots with the same token will conflict.

Local API-only (no bot): `npm run server` or `npm run start:api`.

---

## 7. Railway Volume (REQUIRED)

**This is why balances and completed tasks reset to zero.** Railway’s container disk is ephemeral: every redeploy/restart wipes `server/data`. Account ledger lives in `store.json` — it must sit on a **Volume**.

1. Railway → your service → **Volumes** → create a Volume.
2. Mount path: `/data`
3. Variables:
   - `AZAROV_STORE_DIR=/data`
   - `AZAROV_UPLOADS_DIR=/data/uploads`
4. Keep **one replica** only (`railway.toml` sets `numReplicas = 1`).
   - The JSON ledger + file lock are **not** multi-replica safe.
   - A Railway Volume also blocks horizontal scaling — do not raise replica count.
   - File lock protects concurrent requests **inside one process only**.
   - Do **not** set `AZAROV_ALLOW_MULTI_REPLICA=1` except for emergency diagnostics.
5. Redeploy, then open `GET /api/health` and confirm `store.persistent: true` and `store.singleReplicaRequired: true`.

Expected layout:

```text
/data
├── store.json
├── store.json.bak      (auto backup)
├── store.json.bak.1
├── store.json.lock     (runtime)
└── uploads/
    └── partner-submissions/
        └── <submissionId>.jpg|png|webp
```

Data lost **before** the Volume was mounted cannot be recovered from the app image. After the Volume is mounted, new balances/tasks persist across redeploys.

---

## 8. Health check

```bash
GET /api/health
```

Expected (with Volume):

```json
{
  "ok": true,
  "store": {
    "persistent": true,
    "source": "AZAROV_STORE_DIR",
    "exists": true,
    "backupExists": true,
    "usersCount": 12
  }
}
```

If `store.persistent` is `false`, balances/tasks will reset on the next redeploy — fix the Volume first.

No auth required. Does not expose tokens or user PII.

Use this URL in Railway health checks if configured.

---

## 9. Connect Railway URL to Telegram Mini App

1. Deploy and copy the public HTTPS URL.
2. Set `WEBAPP_URL` to that URL (no trailing slash issues — use the canonical HTTPS URL).
3. In @BotFather → Bot Settings → Menu Button / Web App: set the same URL.
4. In @BotFather also configure **Main Mini App** (Direct Link) to the same URL — required for `https://t.me/<bot>?startapp=<code>` referral links to pass `start_param` into the Mini App.
5. Redeploy or restart so the bot picks up `WEBAPP_URL`.
6. Set `BOT_USERNAME=AZAROV_GiftBot` and optionally `REFERRAL_REWARD=1000`.
5. Open the bot → `/start` → WebApp button should open the Mini App.

---

## 10. Telegram Bot

Production launcher starts the bot automatically (`server/production.mjs`).

Requirements:

- Valid `BOT_TOKEN`
- `WEBAPP_URL` set (otherwise `/start` warns that Mini App is unavailable)

Long polling only (no webhook setup required).

### Channel subscribe task (`@azarov222`)

The task `telegram-subscribe` calls Telegram Bot API `getChatMember`.

Required setup:

1. Add `@AZAROV_GiftBot` (your bot) to the channel `@azarov222` as an **administrator**.
2. Admin rights can be minimal, but the bot must be able to see members (`getChatMember`).
3. Set Railway env `TELEGRAM_CHANNEL=@azarov222` (or the channel numeric id `-100…`).

If the bot is not in the channel, users see a clear error instead of a silent failure, and server logs include `classified: bot_access`.

### Kick OAuth account linking + follow task

Required Railway variables:

| Variable | Purpose |
|----------|---------|
| `KICK_CLIENT_ID` | Kick Developer application client id |
| `KICK_CLIENT_SECRET` | Kick Developer application secret (server only) |
| `KICK_REDIRECT_URI` | Exact callback URL registered in Kick |
| `KICK_REQUIRED_CHANNEL` | Follow-task channel slug (default `azarov7777`) |

Production redirect URI:

`https://azarov-giftbot-production.up.railway.app/api/kick/callback`

In Kick Developer settings:

1. Register that exact OAuth redirect.
2. Enable Webhooks → URL `https://azarov-giftbot-production.up.railway.app/api/kick/webhooks` (**required** for the follow task — Kick has no public “is following?” API).

OAuth scopes requested by the app: **`user:read channel:read`**.

- `user:read` — Kick identity on link
- `channel:read` — channel metadata

Flow uses OAuth 2.1 + PKCE and enforces **1 Telegram ↔ 1 Kick** via unique indexes `kickByTelegram` and `kickAccounts`.

Follow verification:

1. On boot the server subscribes (App Access Token) to `channel.followed` for `KICK_REQUIRED_CHANNEL`.
2. When a user follows, Kick POSTs to `/api/kick/webhooks`; the server stores the event.
3. `POST /api/tasks/kick-follow/check` completes the task when that webhook evidence exists (or a rare pull API hit if Kick ever exposes it).

If follow check never succeeds: confirm the webhook URL in Kick Developer, then `POST /api/admin/kick/follow/subscribe` with `X-Admin-Key`, ask the user to unfollow/refollow, and re-check. Admin diagnostics: `GET /api/admin/kick/status`.

Users who linked Kick **before** token persistence was added must reconnect Kick once so the server can store tokens.

---

## 10b. In-app notifications (Notification Center)

Stored in the same JSON store (`store.notifications`, schema v7), under `withStore` /
file lock. **Not** a separate DB. Single-replica constraint still applies.

### Types

| Type | When created |
|------|----------------|
| `PARTNER_SUBMISSION_APPROVED` | Admin approves partner submission (after ledger reward) |
| `PARTNER_SUBMISSION_REJECTED` | Admin rejects partner submission (requires `rejectionReason`) |
| `ORDER_APPROVED` | Admin completes shop order |
| `ORDER_REJECTED` | Admin rejects shop order (requires reason; refund already applied) |
| `SYSTEM` | Reserved for server-side system messages |

There is **no** public `POST /api/notifications/create`. Clients cannot invent approvals
or rewards via notifications. Reward always comes from ledger first; notification only reports it.

Idempotency: `events[`notification:${eventKey}`]` (e.g.
`partner_submission:${submissionId}:approved`). Replays do not duplicate.

Rejection reason: trim, 3–500 chars; validated on bot + HTTP admin + store mutation.
Saved on `submission.rejectionReason` / `order.rejectionReason` and copied into
notification `metadata.rejectionReason`.

### User API (Telegram auth / web session only; userId from auth)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/notifications?limit=` | Own list + `unreadCount` (default limit 50, max 100) |
| `GET` | `/api/notifications/unread-count` | Badge |
| `POST` | `/api/notifications/read-all` | Mark all own as read |
| `POST` | `/api/notifications/:id/read` | Own only; foreign id → 404 |

Retention: up to **150** notifications per user (oldest **read** pruned first).

Profile UI: **Уведомления** menu with unread badge.

### Top toasts (Mini App)

Frontend-only layer (`ServerNotificationToasts`): polls `GET /api/notifications`
every ~12s while the tab is visible. First poll **seeds** known IDs (no toasts for
history). Later new toastable IDs show a top toast (~5s, queue max 5). Toast does
**not** mark `read`; click opens the existing Notifications sheet/detail.

---

## 11. What not to commit

- `.env` and any real tokens/keys
- `node_modules/`
- `dist/`
- `uploads/`
- `server/data/store.json` and other runtime data
- User screenshots

`.env.example` **should** be committed.

---

## 12. Local production smoke test (optional)

```bash
npm run build

# Use throwaway values only — never real production secrets in shell history if avoidable
set NODE_ENV=production
set BOT_TOKEN=000000:TEST_ONLY
set WEBAPP_URL=http://127.0.0.1:3001
set ADMIN_API_KEY=0123456789abcdef0123456789abcdef
set PORT=3001

npm run start:production
```

Then:

- `http://127.0.0.1:3001/api/health` → `{ "ok": true }`
- `http://127.0.0.1:3001/` → React app
- `http://127.0.0.1:3001/api/nope` → JSON 404 (not `index.html`)

On Windows PowerShell use `$env:NAME="value"` instead of `set`.
