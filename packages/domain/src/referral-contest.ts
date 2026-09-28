import {
  jobs,
  notifications,
  referralContestResults,
  referralContests,
  telegramAccounts,
} from "@giftbot/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { writeAuditIn } from "./admin.js";
import { systemClock, type Clock } from "./clock.js";
import { ConflictError, InvalidAmountError, NotFoundError } from "./errors.js";
import { publicAvatarUrl } from "./https-url.js";
import { asBigInt } from "./money.js";
import { applyIn } from "./wallet.js";

export const REFERRAL_CONTEST_PRIZE_POOL_AZC = 150_000n;
export const REFERRAL_CONTEST_PRIZE_PLACES = 5;
export const REFERRAL_CONTEST_FIRST_PLACE_MAX_AZC = 50_000n;
export const REFERRAL_CONTEST_MIN_ACTIVE_REFERRALS_FOR_REWARD = 5;
export const REFERRAL_CONTEST_DURATION_MS = 24 * 60 * 60 * 1000;
export const REFERRAL_CONTEST_TITLE = "РЕФЕРАЛЬНЫЙ БАТТЛ";
export const REFERRAL_CONTEST_LEADERBOARD_LIMIT = 5;
export const REFERRAL_CONTEST_FINALIZE_JOB = "referral_contest.finalize";

export const REFERRAL_CONTEST_DEFAULT_PRIZES: ReadonlyArray<{
  place: number;
  rewardAzc: string;
}> = [
  { place: 1, rewardAzc: "50000" },
  { place: 2, rewardAzc: "34000" },
  { place: 3, rewardAzc: "30000" },
  { place: 4, rewardAzc: "20000" },
  { place: 5, rewardAzc: "16000" },
];

const LEADERBOARD_CACHE_TTL_MS = 5_000;

export type ReferralContestPrize = {
  place: number;
  rewardAzc: bigint;
};

export type ReferralContestPublicStatus =
  | "scheduled"
  | "active"
  | "ended"
  | "finalized";

export type ReferralContestPrizeDto = {
  place: number;
  rewardAzc: string;
};

export type ReferralContestLeaderboardEntry = {
  rank: number;
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  referralCount: number;
  prizePlace: number | null;
  rewardAzc: string | null;
  isYou: boolean;
};

export type ReferralContestMe = {
  rank: number;
  referralCount: number;
  potentialRewardAzc: string | null;
  referralUrl: string | null;
};

export type ReferralContestHomeSummary = {
  contest: {
    id: string;
    status: ReferralContestPublicStatus;
    startAt: string;
    endAt: string;
    prizes: ReferralContestPrizeDto[];
    serverNow: string;
  } | null;
  leaderboard: ReferralContestLeaderboardEntry[];
  me: ReferralContestMe;
  serverNow: string;
};

type RankedRow = {
  userId: string;
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  photoUrl: string | null;
  referralCount: number;
  scoreReachedAt: Date;
  place: number;
};

type LeaderboardCache = {
  at: number;
  contestId: string;
  frozen: boolean;
  rows: RankedRow[];
};

let leaderboardCache: LeaderboardCache | null = null;
let leaderboardInflight: { contestId: string; promise: Promise<RankedRow[]> } | null =
  null;

export function invalidateReferralContestCache(): void {
  leaderboardCache = null;
  leaderboardInflight = null;
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; i < 4; i += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code: unknown }).code === "23505"
    ) {
      return true;
    }
    if (typeof current !== "object" || current === null || !("cause" in current)) {
      return false;
    }
    current = (current as { cause: unknown }).cause;
  }
  return false;
}

export function parsePrizeDistribution(raw: unknown): ReferralContestPrize[] {
  if (!Array.isArray(raw) || raw.length !== REFERRAL_CONTEST_PRIZE_PLACES) {
    throw new InvalidAmountError(
      `prize distribution must have ${REFERRAL_CONTEST_PRIZE_PLACES} places`,
    );
  }
  const prizes: ReferralContestPrize[] = [];
  const seen = new Set<number>();
  let sum = 0n;
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      throw new InvalidAmountError("prize distribution is invalid");
    }
    const rec = row as Record<string, unknown>;
    const place = Number(rec.place);
    const rewardRaw = rec.rewardAzc ?? rec.reward_azc;
    if (!Number.isInteger(place) || place < 1 || place > REFERRAL_CONTEST_PRIZE_PLACES) {
      throw new InvalidAmountError("prize place is invalid");
    }
    if (seen.has(place)) {
      throw new InvalidAmountError("prize places must be unique");
    }
    seen.add(place);
    const rewardAzc = asBigInt(String(rewardRaw ?? ""));
    if (rewardAzc <= 0n) {
      throw new InvalidAmountError("prize reward must be positive");
    }
    if (place === 1 && rewardAzc > REFERRAL_CONTEST_FIRST_PLACE_MAX_AZC) {
      throw new InvalidAmountError(
        `first place reward cannot exceed ${REFERRAL_CONTEST_FIRST_PLACE_MAX_AZC.toString()}`,
      );
    }
    prizes.push({ place, rewardAzc });
    sum += rewardAzc;
  }
  if (sum !== REFERRAL_CONTEST_PRIZE_POOL_AZC) {
    throw new InvalidAmountError(
      `prize distribution must sum to ${REFERRAL_CONTEST_PRIZE_POOL_AZC.toString()}`,
    );
  }
  return prizes.sort((a, b) => a.place - b.place);
}

export function prizesToJson(prizes: ReferralContestPrize[]): ReferralContestPrizeDto[] {
  return prizes.map((row) => ({
    place: row.place,
    rewardAzc: row.rewardAzc.toString(),
  }));
}

export function publicContestStatus(
  row: { status: string; startAt: Date; endAt: Date; finalizedAt: Date | null },
  now: Date,
): ReferralContestPublicStatus {
  if (row.finalizedAt || row.status === "finalized") {
    return "finalized";
  }
  if (now.getTime() < row.startAt.getTime()) {
    return "scheduled";
  }
  if (now.getTime() >= row.endAt.getTime()) {
    return "ended";
  }
  return "active";
}

function prizeMap(prizes: ReferralContestPrize[]): Map<number, bigint> {
  return new Map(prizes.map((row) => [row.place, row.rewardAzc]));
}

export function contestPayoutForPlace(
  place: number,
  referralCount: number,
  prizes: Map<number, bigint>,
): bigint {
  if (
    place < 1 ||
    place > REFERRAL_CONTEST_PRIZE_PLACES ||
    referralCount < REFERRAL_CONTEST_MIN_ACTIVE_REFERRALS_FOR_REWARD
  ) {
    return 0n;
  }
  return prizes.get(place) ?? 0n;
}

function liveRankSql(startAt: Date, endAt: Date) {
  return sql`
    WITH eligible AS (
      SELECT r.referrer_user_id AS user_id,
             COUNT(*)::int AS referral_count,
             MAX(r.activated_at) AS score_reached_at
      FROM referrals r
      INNER JOIN users referrer
        ON referrer.id = r.referrer_user_id AND referrer.status = 'active'
      INNER JOIN users referee
        ON referee.id = r.referee_user_id AND referee.status = 'active'
      INNER JOIN kick_accounts k
        ON k.user_id = r.referee_user_id AND k.status = 'active'
      WHERE r.status = 'activated'
        AND r.activated_at >= ${startAt.toISOString()}::timestamptz
        AND r.activated_at <= ${endAt.toISOString()}::timestamptz
      GROUP BY r.referrer_user_id
    )
    SELECT
      e.user_id,
      u.public_id,
      u.display_name,
      t.username,
      t.photo_url,
      e.referral_count,
      e.score_reached_at,
      ROW_NUMBER() OVER (
        ORDER BY e.referral_count DESC, e.score_reached_at ASC, e.user_id ASC
      )::int AS place
    FROM eligible e
    INNER JOIN users u ON u.id = e.user_id
    LEFT JOIN telegram_accounts t
      ON t.user_id = e.user_id AND t.is_active = true
    ORDER BY place ASC
  `;
}

function mapRanked(
  rows: Array<{
    user_id: string;
    public_id: string | null;
    display_name: string | null;
    username: string | null;
    photo_url: string | null;
    referral_count: number | string;
    score_reached_at: Date | string;
    place: number | string;
  }>,
): RankedRow[] {
  return rows.map((row) => ({
    userId: row.user_id,
    publicId: row.public_id,
    displayName: row.display_name,
    username: row.username,
    photoUrl: row.photo_url,
    referralCount: Number(row.referral_count),
    scoreReachedAt:
      row.score_reached_at instanceof Date
        ? row.score_reached_at
        : new Date(row.score_reached_at),
    place: Number(row.place),
  }));
}

async function loadLiveRanking(
  db: GiftbotDb | GiftbotTx,
  startAt: Date,
  endAt: Date,
): Promise<RankedRow[]> {
  const rows = await db.execute<{
    user_id: string;
    public_id: string | null;
    display_name: string | null;
    username: string | null;
    photo_url: string | null;
    referral_count: number | string;
    score_reached_at: Date | string;
    place: number | string;
  }>(liveRankSql(startAt, endAt));
  return mapRanked(rows);
}

async function loadFrozenRanking(
  db: GiftbotDb | GiftbotTx,
  contestId: string,
): Promise<RankedRow[]> {
  const rows = await db.execute<{
    user_id: string;
    public_id: string | null;
    display_name: string | null;
    username: string | null;
    photo_url: string | null;
    referral_count: number | string;
    score_reached_at: Date | string;
    place: number | string;
  }>(sql`
    SELECT
      r.user_id,
      u.public_id,
      u.display_name,
      t.username,
      t.photo_url,
      r.referral_count,
      r.score_reached_at,
      r.place
    FROM referral_contest_results r
    INNER JOIN users u ON u.id = r.user_id
    LEFT JOIN telegram_accounts t
      ON t.user_id = r.user_id AND t.is_active = true
    WHERE r.contest_id = ${contestId}
    ORDER BY r.place ASC
  `);
  return mapRanked(rows);
}

async function rankingForContest(
  db: GiftbotDb,
  contest: typeof referralContests.$inferSelect,
): Promise<RankedRow[]> {
  const frozen = Boolean(contest.finalizedAt);
  const now = Date.now();
  if (
    leaderboardCache &&
    leaderboardCache.contestId === contest.id &&
    leaderboardCache.frozen === frozen &&
    now - leaderboardCache.at < LEADERBOARD_CACHE_TTL_MS
  ) {
    return leaderboardCache.rows;
  }
  if (leaderboardInflight && leaderboardInflight.contestId === contest.id) {
    return leaderboardInflight.promise;
  }
  const promise = (async () => {
    const rows = frozen
      ? await loadFrozenRanking(db, contest.id)
      : await loadLiveRanking(db, contest.startAt, contest.endAt);
    leaderboardCache = {
      at: Date.now(),
      contestId: contest.id,
      frozen,
      rows,
    };
    return rows;
  })().finally(() => {
    if (leaderboardInflight?.promise === promise) {
      leaderboardInflight = null;
    }
  });
  leaderboardInflight = { contestId: contest.id, promise };
  return promise;
}

function toEntry(
  row: RankedRow,
  viewerId: string,
  prizes: Map<number, bigint>,
): ReferralContestLeaderboardEntry {
  const inPrizes = row.place <= REFERRAL_CONTEST_PRIZE_PLACES;
  const reward = contestPayoutForPlace(row.place, row.referralCount, prizes);
  return {
    rank: row.place,
    publicId: row.publicId,
    displayName: row.displayName,
    username: row.username,
    avatarUrl: publicAvatarUrl(row.photoUrl),
    referralCount: row.referralCount,
    prizePlace: inPrizes ? row.place : null,
    rewardAzc: reward > 0n ? reward.toString() : null,
    isYou: row.userId === viewerId,
  };
}

function buildMe(
  rows: RankedRow[],
  viewerId: string,
  prizes: Map<number, bigint>,
  referralUrl: string | null,
): ReferralContestMe {
  const mine = rows.find((row) => row.userId === viewerId);
  const rank = mine?.place ?? 0;
  const referralCount = mine?.referralCount ?? 0;
  const potential = contestPayoutForPlace(rank, referralCount, prizes);
  return {
    rank,
    referralCount,
    potentialRewardAzc: potential ? potential.toString() : null,
    referralUrl,
  };
}

export async function findOpenReferralContest(
  db: GiftbotDb | GiftbotTx,
): Promise<typeof referralContests.$inferSelect | null> {
  const rows = await db
    .select()
    .from(referralContests)
    .where(sql`${referralContests.finalizedAt} is null`)
    .orderBy(asc(referralContests.startAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCurrentReferralContest(
  db: GiftbotDb,
): Promise<typeof referralContests.$inferSelect | null> {
  const open = await findOpenReferralContest(db);
  if (open) {
    return open;
  }
  const rows = await db
    .select()
    .from(referralContests)
    .orderBy(sql`${referralContests.startAt} desc`)
    .limit(1);
  return rows[0] ?? null;
}

export async function readReferralContestHomeSummary(
  db: GiftbotDb,
  input: { userId: string; referralUrl: string | null; clock?: Clock },
): Promise<ReferralContestHomeSummary> {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const serverNow = now.toISOString();
  const emptyMe: ReferralContestMe = {
    rank: 0,
    referralCount: 0,
    potentialRewardAzc: null,
    referralUrl: input.referralUrl,
  };
  const row = await findCurrentReferralContest(db);
  if (!row) {
    return {
      contest: null,
      leaderboard: [],
      me: emptyMe,
      serverNow,
    };
  }
  const parsed = parsePrizeDistribution(row.prizeDistribution);
  const prizes = prizeMap(parsed);
  const ranked = await rankingForContest(db, row);
  const top = ranked.slice(0, REFERRAL_CONTEST_LEADERBOARD_LIMIT);
  return {
    contest: {
      id: row.id,
      status: publicContestStatus(row, now),
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      prizes: prizesToJson(parsed),
      serverNow,
    },
    leaderboard: top.map((entry) => toEntry(entry, input.userId, prizes)),
    me: buildMe(ranked, input.userId, prizes, input.referralUrl),
    serverNow,
  };
}

async function enqueueFinalizeJob(
  tx: GiftbotTx,
  contestId: string,
  endAt: Date,
): Promise<void> {
  await tx
    .insert(jobs)
    .values({
      type: REFERRAL_CONTEST_FINALIZE_JOB,
      owner: "worker",
      payload: { contest_id: contestId },
      idempotencyKey: `referral_contest.finalize:${contestId}`,
      nextAttemptAt: endAt,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

export async function ensureDefaultReferralContest(
  db: GiftbotDb,
  input: { clock?: Clock } = {},
): Promise<{ id: string; status: string; startAt: string; endAt: string }> {
  const clock = input.clock ?? systemClock;
  const existing = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"referral-contest-ensure-default"}))`,
    );
    const rows = await tx.select().from(referralContests).limit(1);
    const found = rows[0];
    if (found) {
      return found;
    }
    const now = clock.now();
    const startAt = now;
    const endAt = new Date(startAt.getTime() + REFERRAL_CONTEST_DURATION_MS);
    const prizes = parsePrizeDistribution([...REFERRAL_CONTEST_DEFAULT_PRIZES]);
    try {
      const inserted = await tx
        .insert(referralContests)
        .values({
          status: "active",
          title: REFERRAL_CONTEST_TITLE,
          startAt,
          endAt,
          prizePoolAzc: REFERRAL_CONTEST_PRIZE_POOL_AZC,
          prizeDistribution: prizesToJson(prizes),
          startedAt: startAt,
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error("contest insert failed");
      }
      await enqueueFinalizeJob(tx, row.id, endAt);
      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const again = await tx.select().from(referralContests).limit(1);
      const recovered = again[0];
      if (!recovered) {
        throw error;
      }
      return recovered;
    }
  });
  invalidateReferralContestCache();
  return {
    id: existing.id,
    status: existing.status,
    startAt: existing.startAt.toISOString(),
    endAt: existing.endAt.toISOString(),
  };
}

async function insertInbox(
  tx: GiftbotTx,
  input: {
    userId: string;
    type: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(notifications).values({
    userId: input.userId,
    channel: "inbox",
    type: input.type,
    status: "sent",
    title: input.title,
    body: input.body,
    sentAt: new Date(),
    payload: input.payload,
  });
}

async function enqueueTelegramNotice(
  tx: GiftbotTx,
  input: { userId: string; idempotencyKey: string; text: string },
): Promise<void> {
  const rows = await tx
    .select({ telegramUserId: telegramAccounts.telegramUserId })
    .from(telegramAccounts)
    .where(
      and(
        eq(telegramAccounts.userId, input.userId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .limit(1);
  const chatId = rows[0]?.telegramUserId;
  if (chatId === undefined || chatId === null) {
    return;
  }
  await tx
    .insert(jobs)
    .values({
      type: "telegram.send_message",
      owner: "bot",
      payload: { chat_id: Number(chatId), text: input.text },
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: [jobs.type, jobs.idempotencyKey] });
}

function winnerCopy(
  place: number,
  rewardAzc: bigint,
): { title: string; body: string; text: string } {
  const amount = rewardAzc.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = `Ты занял ${place} место и получил ${amount} монет 🎁`;
  return {
    title: "Реферальный баттл завершён!",
    body,
    text: `🏆 Реферальный баттл завершён!\n\n${body}`,
  };
}

export async function finalizeReferralContest(
  db: GiftbotDb,
  contestId: string,
  input: { now?: Date; closeWindow?: boolean; adminUserId?: string } = {},
): Promise<{ replayed: boolean; winnerCount: number }> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`referral-contest-finalize:${contestId}`}))`,
    );
    const rows = await tx
      .select()
      .from(referralContests)
      .where(eq(referralContests.id, contestId))
      .limit(1)
      .for("update");
    const contest = rows[0];
    if (!contest) {
      throw new NotFoundError("contest not found", "CONTEST_NOT_FOUND");
    }
    if (contest.finalizedAt) {
      const winners = await tx
        .select({ id: referralContestResults.id })
        .from(referralContestResults)
        .where(
          and(
            eq(referralContestResults.contestId, contest.id),
            sql`${referralContestResults.rewardAzc} > 0`,
          ),
        );
      return { replayed: true, winnerCount: winners.length };
    }

    const now = input.now ?? new Date();
    if (input.closeWindow && now.getTime() < contest.endAt.getTime()) {
      await tx
        .update(referralContests)
        .set({ endAt: now })
        .where(eq(referralContests.id, contest.id));
      contest.endAt = now;
    } else if (now.getTime() < contest.endAt.getTime()) {
      throw new ConflictError("contest has not ended yet", "CONTEST_NOT_ENDED");
    }

    const prizes = parsePrizeDistribution(contest.prizeDistribution);
    const rewards = prizeMap(prizes);
    const ranked = await loadLiveRanking(tx, contest.startAt, contest.endAt);

    for (const row of ranked) {
      const reward = contestPayoutForPlace(row.place, row.referralCount, rewards);
      await tx
        .insert(referralContestResults)
        .values({
          contestId: contest.id,
          userId: row.userId,
          place: row.place,
          referralCount: row.referralCount,
          scoreReachedAt: row.scoreReachedAt,
          rewardAzc: reward,
        })
        .onConflictDoNothing({
          target: [referralContestResults.contestId, referralContestResults.userId],
        });
    }

    const stored = await tx
      .select()
      .from(referralContestResults)
      .where(eq(referralContestResults.contestId, contest.id))
      .orderBy(asc(referralContestResults.place));

    let winnerCount = 0;
    for (const row of stored) {
      const reward = asBigInt(row.rewardAzc);
      if (reward <= 0n) {
        continue;
      }
      winnerCount += 1;
      const paid = await applyIn(tx, {
        userId: row.userId,
        type: "referral_contest_reward",
        amountMinor: reward,
        idempotencyKey: `referral-contest:${contest.id}:place:${row.place}:user:${row.userId}`,
        actorType: "worker",
        reason: `Реферальный баттл: ${row.place} место`,
        referenceType: "referral_contest",
        referenceId: contest.id,
        metadata: { place: row.place, contestId: contest.id },
      });
      if (!row.rewardTransactionId) {
        await tx
          .update(referralContestResults)
          .set({ rewardTransactionId: paid.transaction.id })
          .where(eq(referralContestResults.id, row.id));
      }
      if (!paid.replayed) {
        const copy = winnerCopy(row.place, reward);
        await insertInbox(tx, {
          userId: row.userId,
          type: "referral_contest_reward",
          title: copy.title,
          body: copy.body,
          payload: {
            contestId: contest.id,
            place: row.place,
            rewardAzc: reward.toString(),
          },
        });
        await enqueueTelegramNotice(tx, {
          userId: row.userId,
          idempotencyKey: `telegram:referral-contest:${contest.id}:place:${row.place}:user:${row.userId}`,
          text: copy.text,
        });
      }
    }

    await tx
      .update(referralContests)
      .set({
        status: "finalized",
        finalizedAt: now,
      })
      .where(eq(referralContests.id, contest.id));

    if (input.adminUserId) {
      await writeAuditIn(tx, {
        actorId: input.adminUserId,
        action: "referral_contest.finalize",
        targetType: "referral_contest",
        targetId: contest.id,
        reason: "finalize referral contest",
        after: { winnerCount },
      });
    }

    return { replayed: false, winnerCount };
  });
  invalidateReferralContestCache();
  return result;
}
