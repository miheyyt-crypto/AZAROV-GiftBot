# Pending product decisions

These items are **not** architecture facts.  
Do not invent values. Do not encode them as if decided.

Canonical architecture: [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)

| # | Decision | Why it waits | When product is blocked |
|---|---|---|---|
| 1 | ~~When a referral is **activated**~~ | **Decided** — Kick account link activates referral; +1000/+1000 AZC; no activation notifications — see Explicitly not pending | — |
| 2 | What counts as proven Kick watch / presence | Chat presence is not watch time | Interpreting events: Phase 9–10 |
| 3 | Concrete game rules | Mechanics are not chosen | Phase 10 |
| 4 | Reward sizes / economy amounts | No numbers exist | Phase 10 |
| 5 | ~~Shop prices and what is delivered~~ | **Decided** — see Explicitly not pending | Shop Orders stage |
| 6 | Giveaway rules (eligibility, winner count) | No rules exist | Phase 10–11 |
| 7 | ~~Task requirements and task rewards~~ | **Decided** — permanent built-in catalog + Welvura 13-stage chain — see Explicitly not pending | — |
| 8 | ~~Case probabilities / RTP~~ | **Decided** for Нищий/Средний/Блатной and Referral Case — see Explicitly not pending | — |
| 9 | ~~Exact session TTL and `auth_date` window~~ | **Decided** — initData 1800s at session create only; Mini App session 2_592_000s; admin 7200s; future skew 60s — see Explicitly not pending | — |
| 10 | Exact notification rules | What/when to send is unknown | Table earlier; policy Phase 10–12 |
| 11 | Admin roles besides `super_admin` | One role is enough to start | Phase 11 |
| 12 | Currency code and minor-unit scale | Denomination is not chosen | `BIGINT` is decided. The value waits until Phase 10 |
| 13 | Whether provably-fair commit-reveal is required | Optional product choice | Phase 10 if requested |
| 14 | Repeatable tasks / periods | May never exist | Until decided, completions are one-shot `(task, user)` |

## Phase 16 go-live flags

At Phase 16 close, all 14 rows above were **FLAG OFF**. Row **#5 (Shop prices)**, later **#8 (Paid case odds for Нищий/Средний/Блатной)**, then **#1 (referral Kick activation)** plus **referral case odds**, then **#7 (Tasks + Welvura rewards)**, and then **#9 (session TTL / auth_date)** were product-decided and are no longer pending.

Remaining pending rows stay **FLAG OFF** for go-live:

- Dependent features stay disabled or require catalog rows that are not seeded.
- `TEMPORARY_UNCONFIRMED` operational defaults (rate limits, job retry) are not product decisions.
- Closing Phase 16 does **not** mean the product is production-ready.

Machine-readable copy: `tools/validate` `PENDING_GO_LIVE_FLAGS` (9 still-pending flags).

## Explicitly not pending

Already decided by architecture (do not reopen as product guesses):

- PostgreSQL is the only source of truth
- GET is read-only
- Wallet ledger + `opening_balance_minor`
- Exclusive job `owner` for Bot vs Worker
- Unified `inbound_events` (variant A)
- Session rotation (one active Mini App session)
- Expand/contract migrations
- Instant vs async game lifecycles
- No Redis in stage 1
- No V1 runtime dependency
- **Shop catalog:** nine products with exact AZC prices (200/500/5000 ₽ Welvura, donation, music, Streak Freeze, Premium 6/12, VIP Kick); manual Admin fulfillment except Streak Freeze inventory grant
- **Free Case:** 16 items, real integer weights totaling 600000 (0.001%/0.002%/equal common share of 99.986%), display odds 6/20/74 deliberately separate, 24h cooldown after successful open
- **Paid Cases (Нищий / Средний / Блатной):** prices 8999 / 22222 / 64999 AZC; real integer weights totaling 100000000 (exact 0.001% / 0.1% / 1% / … / 62.998%); `displayChance` stays null until product decides display odds; AZC + cash_rub only
- **Referral activation:** Kick account link activates an attributed referral; +1000 AZC to inviter and +1000 AZC to referred (ledger types `referral_inviter_reward` / `referral_referred_reward`); no activation notifications; entitlement for a referral case every 5 activated referrals
- **Referral Case:** entitlement-only (no AZC price); catalog weights totaling 100000000; `displayChance` stays null; AZC + cash_rub rewards
- **Tasks (permanent built-in):** codes `kick_nickname_tag` (400), `kick_link` (400), `kick_follow_azarov7777` (500), `telegram_subscribe_azarov222` (500), `telegram_bot_started` (600), `referral_3_active` (2000); one-time completions; rewards via `Wallet.apply` type `task_reward`
- **Welvura:** account-link moderation (+1000 AZC once on approve via `Wallet.apply` type `task_reward`, idempotency `welvura.account.reward:${submissionId}`) then 13 sequential deposit stages (100₽→2000 … 1_000_000₽→2_000_000 AZC); deposits from 2026-09-11 inclusive (manual policy); one deposit = one stage; deposit rewards via `welvura_deposit_reward`
- **Auth / session TTL (#9):** Telegram initData max age **1800s** checked only at Mini App / admin session creation; Mini App session TTL **2_592_000s** (30 days); admin session TTL **7200s** (2 hours, intentionally shorter); future `auth_date` skew max **60s**; existing sessions are not re-checked against initData age
