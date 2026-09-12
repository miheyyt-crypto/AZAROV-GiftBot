/**
 * One-shot admin adjustment: +25 active Kick referrals for @alldepww (8014934649).
 *
 * Does NOT create users / kickAccounts / store.referrals / coin ledger entries.
 * Idempotent via store.events + store.manualReferralCredits creditKey.
 *
 * Usage:
 *   node scripts/manual-referral-credit-alldepww.mjs           # plan only (default)
 *   node scripts/manual-referral-credit-alldepww.mjs --plan    # same
 *   node scripts/manual-referral-credit-alldepww.mjs --apply   # backup + write
 *
 * Production (VPS):
 *   cd /var/www/AZAROV-GiftBot
 *   AZAROV_STORE_DIR=/data node scripts/manual-referral-credit-alldepww.mjs
 *   AZAROV_STORE_DIR=/data node scripts/manual-referral-credit-alldepww.mjs --apply
 */

import { copyFileSync, existsSync } from 'node:fs'

import {
  ALLDEPWW_MANUAL_CREDIT,
  applyManualReferralCreditOnStore,
  getManualReferralCreditAmount,
  planManualReferralCredit,
} from '../server/manual-referral-credit.mjs'
import {
  REFERRAL_CONTEST_ID,
  buildReferralContestRanking,
  getReferralContestConfig,
} from '../server/referral-contest.mjs'
import { getStorePath, withStore, withStoreRead } from '../server/store.mjs'
import { countActiveReferrals } from '../server/users.mjs'

const apply = process.argv.includes('--apply')
const planOnly = !apply

function backupStoreFile() {
  const storePath = getStorePath()
  if (!existsSync(storePath)) {
    throw new Error(`store_missing:${storePath}`)
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${storePath}.manual-ref-credit.${stamp}.bak`
  copyFileSync(storePath, backupPath)
  return { storePath, backupPath }
}

function snapshot(store) {
  const tgId = ALLDEPWW_MANUAL_CREDIT.telegramUserId
  const user = store.users?.[String(tgId)] || null
  const config = getReferralContestConfig(store)
  const ranked = buildReferralContestRanking(store, config)
  const me = ranked.find((row) => Number(row.telegramId) === tgId) || null
  const referralKeys = Object.keys(store.referrals || {}).filter((id) => {
    const row = store.referrals[id]
    return Number(row?.referrerUserId) === tgId
  })

  return {
    storePath: getStorePath(),
    telegramUserId: tgId,
    username: user?.username || null,
    userExists: Boolean(user),
    coins: user?.balance ?? null,
    activeReferralsField: user?.activeReferrals ?? null,
    countActiveReferrals: user ? countActiveReferrals(store, tgId) : 0,
    manualCreditAmount: getManualReferralCreditAmount(store, tgId),
    realReferralCountAsReferrer: referralKeys.length,
    contestId: config.id || REFERRAL_CONTEST_ID,
    contestScore: me?.score ?? 0,
    contestRank: me ? ranked.findIndex((row) => Number(row.telegramId) === tgId) + 1 : null,
    rankingSize: ranked.length,
  }
}

console.info('[manual-referral-credit] mode', { apply, planOnly })

const before = withStoreRead((store) => ({
  plan: planManualReferralCredit(store, ALLDEPWW_MANUAL_CREDIT),
  snapshot: snapshot(store),
}))

console.info('[manual-referral-credit] planned changes', {
  credit: ALLDEPWW_MANUAL_CREDIT,
  plan: before.plan,
  before: before.snapshot,
  afterIfApplied: {
    manualCreditAmount: ALLDEPWW_MANUAL_CREDIT.amount,
    countActiveReferrals:
      before.snapshot.countActiveReferrals -
      before.snapshot.manualCreditAmount +
      (before.plan.alreadyApplied ? before.snapshot.manualCreditAmount : ALLDEPWW_MANUAL_CREDIT.amount),
    contestScoreDelta: before.plan.alreadyApplied ? 0 : ALLDEPWW_MANUAL_CREDIT.amount,
    wouldCreatePhantomUsers: false,
    wouldTouchStoreReferrals: false,
    wouldGrantCoins: false,
    wouldCallActivateReferral: false,
  },
})

if (planOnly) {
  console.info('[manual-referral-credit] plan-only — no write. Re-run with --apply to persist.')
  process.exit(0)
}

if (!before.plan.userExists) {
  console.error('[manual-referral-credit] abort: user_not_found')
  process.exit(1)
}

if (before.plan.alreadyApplied) {
  console.info('[manual-referral-credit] already applied — no write')
  process.exit(0)
}

const backup = backupStoreFile()
console.info('[manual-referral-credit] backup created', backup)

const result = withStore((store) => {
  const applied = applyManualReferralCreditOnStore(store, ALLDEPWW_MANUAL_CREDIT)
  return {
    applied,
    after: snapshot(store),
  }
})

console.info('[manual-referral-credit] done', {
  backupPath: backup.backupPath,
  result: result.applied,
  after: result.after,
})
