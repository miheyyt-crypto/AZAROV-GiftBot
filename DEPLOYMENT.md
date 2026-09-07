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
| `REFERRAL_REWARD` | optional | Coins for both sides on first referral registration (default `500`) |
| `WEBAPP_URL` | yes | Public HTTPS URL of the Mini App |
| `TELEGRAM_CHANNEL` | recommended | Channel for subscribe task (`@azarov222`). Bot must be an **administrator** of this channel so `getChatMember` works. |
| `PORT` | set by Railway | HTTP listen port |
| `HOST` | optional | Default `0.0.0.0` |
| `NODE_ENV` | yes (`production`) | Enables production checks |
| `CORS_ORIGINS` | optional if `WEBAPP_URL` set | Extra allowed origins |
| `ADMIN_API_KEY` | yes (≥ 32 chars) | Admin moderation header |
| `AZAROV_STORE_DIR` | recommended on Railway | JSON store directory |
| `AZAROV_UPLOADS_DIR` | recommended on Railway | Uploads base directory |
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

### AZAROV_STORE_DIR

Directory for `store.json` (and lock/temp files).

- Local default: `server/data`
- Railway Volume example: `/data` → file `/data/store.json`

### AZAROV_UPLOADS_DIR

Base directory for partner screenshots.

- Local default: `<project>/uploads`
- Railway example: `/data/uploads` → files in `/data/uploads/partner-submissions/`

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

This starts:

1. Express API on `HOST:PORT`
2. Serves `dist/` for the Mini App (same domain)
3. Telegram Bot via long polling (single instance)

Do **not** also run `npm run start:bot` in a second service — two bots with the same token will conflict.

Keep `npm start` / `npm run start:bot` for local/API-only use.

---

## 7. Railway Volume

JSON store and uploads must survive redeploys.

1. Create a Volume in Railway.
2. Mount path: `/data`
3. Set:
   - `AZAROV_STORE_DIR=/data`
   - `AZAROV_UPLOADS_DIR=/data/uploads`

Expected layout:

```text
/data
├── store.json
├── store.json.lock   (runtime)
└── uploads/
    └── partner-submissions/
        └── <submissionId>.jpg|png|webp
```

**Important:** run **one** replica only. The JSON store is not safe across multiple instances.

---

## 8. Health check

```bash
GET /api/health
```

Expected:

```json
{ "ok": true }
```

No auth required. Does not expose tokens or user data.

Use this URL in Railway health checks if configured.

---

## 9. Connect Railway URL to Telegram Mini App

1. Deploy and copy the public HTTPS URL.
2. Set `WEBAPP_URL` to that URL (no trailing slash issues — use the canonical HTTPS URL).
3. In @BotFather → Bot Settings → Menu Button / Web App: set the same URL.
4. In @BotFather also configure **Main Mini App** (Direct Link) to the same URL — required for `https://t.me/<bot>?startapp=<code>` referral links to pass `start_param` into the Mini App.
5. Redeploy or restart so the bot picks up `WEBAPP_URL`.
6. Set `BOT_USERNAME=AZAROV_GiftBot` and optionally `REFERRAL_REWARD=500`.
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
