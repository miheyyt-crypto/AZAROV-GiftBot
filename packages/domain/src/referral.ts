import {
  kickAccounts,
  manualReferralCredits,
  referralCaseEntitlements,
  referralCodes,
  referralEvents,
  referrals,
  telegramAccounts,
  users,
  walletTransactions,
  wallets,
} from "@giftbot/db/schema";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { publicAvatarUrl } from "./https-url.js";
import { asBigInt } from "./money.js";
import {
  clampProfileListLimit,
  encodeProfileCursor,
  type ProfileListCursor,
} from "./profile-read.js";
import { assertTransition, referralTransitions } from "./states.js";
import { applyIn } from "./wallet.js";

export type ReferralStatus =
  | "attributed"
  | "pending_activation"
  | "activated"
  | "rejected"
  | "reversed";

export const REFERRAL_ACTIVATION_REWARD_AZC = 1_000n;
export const REFERRAL_CASE_MILESTONE_SIZE = 5;

export function buildReferralUrl(token: string, botUsername: string): string {
  const user = botUsername.replace(/^@/, "").trim();
  if (!user) {
    throw new Error("TELEGRAM_BOT_USERNAME is required to build referral URL");
  }
  return `https://t.me/${user}?start=${encodeURIComponent(token)}`;
}

async function ensureWallet(tx: GiftbotTx, userId: string): Promise<void> {
  const rows = await tx
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  if (!rows[0]) {
    await tx.insert(wallets).values({ userId });
  }
}

export async function attributeReferral(
  db: GiftbotDb,
  input: { refereeUserId: string; code: string },
): Promise<{ id: string; status: ReferralStatus; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(referrals)
      .where(eq(referrals.refereeUserId, input.refereeUserId))
      .limit(1);
    const already = existing[0];
    if (already) {
      return {
        id: already.id,
        status: already.status,
        replayed: true,
      };
    }

    const codes = await tx
      .select()
      .from(referralCodes)
      .where(
        and(eq(referralCodes.code, input.code), eq(referralCodes.isActive, true)),
      )
      .limit(1);
    const code = codes[0];
    if (!code) {
      throw new NotFoundError("referral code not found");
    }
    if (code.userId === input.refereeUserId) {
      throw new ConflictError("self-referral is not allowed");
    }

    const inserted = await tx
      .insert(referrals)
      .values({
        referrerUserId: code.userId,
        refereeUserId: input.refereeUserId,
        referralCodeUsed: code.code,
        status: "attributed",
      })
      .returning();
    const referral = inserted[0];
    if (!referral) {
      throw new Error("failed to attribute referral");
    }

    await tx.insert(referralEvents).values({
      referralId: referral.id,
      type: "attributed",
      idempotencyKey: `referral:${referral.id}:attributed`,
      payload: { code: code.code },
    });

    return { id: referral.id, status: "attributed", replayed: false };
  });
}

export async function transitionReferral(
  db: GiftbotDb,
  input: {
    referralId: string;
    to: "rejected" | "reversed";
    reason?: string;
  },
): Promise<{ id: string; status: ReferralStatus }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(referrals)
      .where(eq(referrals.id, input.referralId))
      .for("update");
    const referral = rows[0];
    if (!referral) {
      throw new NotFoundError("referral not found");
    }

    if (referral.status === input.to) {
      return { id: referral.id, status: referral.status };
    }

    assertTransition("referral", referralTransitions, referral.status, input.to);

    const rejectedAt =
      input.to === "rejected" ? new Date() : referral.rejectedAt;

    await tx
      .update(referrals)
      .set({
        status: input.to,
        rejectedAt,
        rejectReason: input.to === "rejected" ? input.reason : referral.rejectReason,
      })
      .where(eq(referrals.id, referral.id));

    await tx.insert(referralEvents).values({
      referralId: referral.id,
      type: input.to,
      idempotencyKey: `referral:${referral.id}:${input.to}`,
      payload: input.reason ? { reason: input.reason } : {},
    });

    return { id: referral.id, status: input.to };
  });
}

export async function countActivatedReferrals(
  db: GiftbotDb | GiftbotTx,
  referrerUserId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerUserId, referrerUserId),
        eq(referrals.status, "activated"),
      ),
    );
  return Number(rows[0]?.value ?? 0);
}

export async function sumManualReferralCredits(
  db: GiftbotDb | GiftbotTx,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({
      total: sql<string>`coalesce(sum(${manualReferralCredits.amount}), 0)::text`,
    })
    .from(manualReferralCredits)
    .where(eq(manualReferralCredits.userId, userId));
  return Number(rows[0]?.total ?? 0);
}

/** Friends/stats + referral-case eligibility. Contest leaderboard stays real-activated only. */
export async function canonicalActiveReferralCount(
  db: GiftbotDb | GiftbotTx,
  userId: string,
): Promise<number> {
  const [real, manual] = await Promise.all([
    countActivatedReferrals(db, userId),
    sumManualReferralCredits(db, userId),
  ]);
  return real + manual;
}

export async function syncReferralCaseMilestones(
  tx: GiftbotTx,
  referrerUserId: string,
  canonicalCount: number,
): Promise<{ granted: number; maxMilestone: number }> {
  const maxMilestone = Math.floor(canonicalCount / REFERRAL_CASE_MILESTONE_SIZE);
  if (maxMilestone <= 0) {
    return { granted: 0, maxMilestone: 0 };
  }
  const existing = await tx
    .select({ milestoneNumber: referralCaseEntitlements.milestoneNumber })
    .from(referralCaseEntitlements)
    .where(eq(referralCaseEntitlements.userId, referrerUserId));
  const have = new Set(existing.map((row) => row.milestoneNumber));
  let granted = 0;
  for (let milestoneNumber = 1; milestoneNumber <= maxMilestone; milestoneNumber += 1) {
    if (have.has(milestoneNumber)) {
      continue;
    }
    const inserted = await tx
      .insert(referralCaseEntitlements)
      .values({
        userId: referrerUserId,
        milestoneNumber,
        referralCountThreshold: milestoneNumber * REFERRAL_CASE_MILESTONE_SIZE,
      })
      .onConflictDoNothing({
        target: [
          referralCaseEntitlements.userId,
          referralCaseEntitlements.milestoneNumber,
        ],
      })
      .returning({ id: referralCaseEntitlements.id });
    if (inserted[0]) {
      granted += 1;
    }
  }
  return { granted, maxMilestone };
}

/** Inserts the next N milestones after the current max. Used when a new manual credit should add cases on top of already-earned V1/cutover entitlements. */
export async function grantAdditionalReferralCaseMilestones(
  tx: GiftbotTx,
  userId: string,
  extraCount: number,
): Promise<number> {
  if (!Number.isInteger(extraCount) || extraCount <= 0) {
    return 0;
  }
  const existing = await tx
    .select({ milestoneNumber: referralCaseEntitlements.milestoneNumber })
    .from(referralCaseEntitlements)
    .where(eq(referralCaseEntitlements.userId, userId));
  const maxExisting = existing.reduce(
    (max, row) => Math.max(max, row.milestoneNumber),
    0,
  );
  let granted = 0;
  for (let i = 1; i <= extraCount; i += 1) {
    const milestoneNumber = maxExisting + i;
    const inserted = await tx
      .insert(referralCaseEntitlements)
      .values({
        userId,
        milestoneNumber,
        referralCountThreshold: milestoneNumber * REFERRAL_CASE_MILESTONE_SIZE,
      })
      .onConflictDoNothing({
        target: [
          referralCaseEntitlements.userId,
          referralCaseEntitlements.milestoneNumber,
        ],
      })
      .returning({ id: referralCaseEntitlements.id });
    if (inserted[0]) {
      granted += 1;
    }
  }
  return granted;
}

async function countActivatedForReferrer(
  tx: GiftbotTx,
  referrerUserId: string,
): Promise<number> {
  return countActivatedReferrals(tx, referrerUserId);
}

async function grantMilestoneIfNeeded(
  tx: GiftbotTx,
  referrerUserId: string,
  canonicalCount: number,
): Promise<{ granted: boolean; milestoneNumber: number | null }> {
  const beforeMax = Math.floor(
    Math.max(0, canonicalCount - 1) / REFERRAL_CASE_MILESTONE_SIZE,
  );
  const synced = await syncReferralCaseMilestones(
    tx,
    referrerUserId,
    canonicalCount,
  );
  return {
    granted: synced.granted > 0,
    milestoneNumber:
      synced.granted > 0 && synced.maxMilestone > beforeMax
        ? synced.maxMilestone
        : synced.granted > 0
          ? synced.maxMilestone
          : null,
  };
}

export type ActivateReferralResult = {
  activated: boolean;
  replayed: boolean;
  referralId: string | null;
  activeCount: number | null;
  milestoneGranted: boolean;
  milestoneNumber: number | null;
};

/**
 * Activate the referee's attributed referral after a successful Kick link.
 * Idempotent: re-link / concurrent calls reward at most once.
 * No in-app or Telegram activation notifications by product rule.
 */
export async function activateReferralIfEligible(
  db: GiftbotDb,
  refereeUserId: string,
): Promise<ActivateReferralResult> {
  const result = await db.transaction(async (tx) => {
    const kick = await tx
      .select({ id: kickAccounts.id })
      .from(kickAccounts)
      .where(
        and(
          eq(kickAccounts.userId, refereeUserId),
          eq(kickAccounts.status, "active"),
        ),
      )
      .limit(1);
    if (!kick[0]) {
      return {
        activated: false,
        replayed: false,
        referralId: null,
        activeCount: null,
        milestoneGranted: false,
        milestoneNumber: null,
      };
    }

    const rows = await tx
      .select()
      .from(referrals)
      .where(eq(referrals.refereeUserId, refereeUserId))
      .for("update");
    const referral = rows[0];
    if (!referral) {
      return {
        activated: false,
        replayed: false,
        referralId: null,
        activeCount: null,
        milestoneGranted: false,
        milestoneNumber: null,
      };
    }

    if (referral.status === "activated") {
      const activeCount = await countActivatedForReferrer(
        tx,
        referral.referrerUserId,
      );
      return {
        activated: false,
        replayed: true,
        referralId: referral.id,
        activeCount,
        milestoneGranted: false,
        milestoneNumber: null,
      };
    }

    if (referral.status !== "attributed" && referral.status !== "pending_activation") {
      return {
        activated: false,
        replayed: false,
        referralId: referral.id,
        activeCount: null,
        milestoneGranted: false,
        milestoneNumber: null,
      };
    }

    assertTransition(
      "referral",
      referralTransitions,
      referral.status,
      "activated",
    );

    const now = new Date();
    await tx
      .update(referrals)
      .set({
        status: "activated",
        activatedAt: now,
      })
      .where(eq(referrals.id, referral.id));

    await ensureWallet(tx, referral.referrerUserId);
    await ensureWallet(tx, referral.refereeUserId);

    await applyIn(tx, {
      userId: referral.referrerUserId,
      type: "referral_inviter_reward",
      amountMinor: REFERRAL_ACTIVATION_REWARD_AZC,
      idempotencyKey: `referral.inviter:${referral.id}`,
      actorType: "system",
      reason: "Реферальная награда",
      referenceType: "referral",
      referenceId: referral.id,
      metadata: {
        role: "inviter",
        referralId: referral.id,
        refereeUserId: referral.refereeUserId,
      },
    });

    await applyIn(tx, {
      userId: referral.refereeUserId,
      type: "referral_referred_reward",
      amountMinor: REFERRAL_ACTIVATION_REWARD_AZC,
      idempotencyKey: `referral.referred:${referral.id}`,
      actorType: "system",
      reason: "Бонус за приглашение",
      referenceType: "referral",
      referenceId: referral.id,
      metadata: {
        role: "referred",
        referralId: referral.id,
        referrerUserId: referral.referrerUserId,
      },
    });

    await tx.insert(referralEvents).values({
      referralId: referral.id,
      type: "activated",
      idempotencyKey: `referral:${referral.id}:activated`,
      payload: {},
    });
    await tx.insert(referralEvents).values({
      referralId: referral.id,
      type: "reward_granted",
      idempotencyKey: `referral:${referral.id}:reward_granted`,
      payload: {
        inviterAzc: REFERRAL_ACTIVATION_REWARD_AZC.toString(),
        referredAzc: REFERRAL_ACTIVATION_REWARD_AZC.toString(),
      },
    });

    const canonical = await canonicalActiveReferralCount(
      tx,
      referral.referrerUserId,
    );
    const milestone = await grantMilestoneIfNeeded(
      tx,
      referral.referrerUserId,
      canonical,
    );

    const { evaluateAchievementsIn } = await import("./achievements.js");
    await evaluateAchievementsIn(tx, referral.referrerUserId);

    return {
      activated: true,
      replayed: false,
      referralId: referral.id,
      activeCount: canonical,
      milestoneGranted: milestone.granted,
      milestoneNumber: milestone.milestoneNumber,
    };
  });
  if (result.activated) {
    invalidateReferralLeaderboardCache();
  }
  return result;
}

/** Production + local hook after successful Kick account link. */
export async function onKickAccountLinked(
  db: GiftbotDb,
  userId: string,
): Promise<ActivateReferralResult> {
  return activateReferralIfEligible(db, userId);
}

export type ReferralMeSummary = {
  referralUrl: string;
  token: string;
  stats: {
    invited: number;
    active: number;
    earnedAzc: string;
  };
  caseProgress: {
    current: number;
    target: number;
    availableCases: number;
    totalCasesEarned: number;
  };
};

export async function readReferralMe(
  db: GiftbotDb,
  input: { userId: string; botUsername: string },
): Promise<ReferralMeSummary> {
  const codeRows = await db
    .select()
    .from(referralCodes)
    .where(
      and(
        eq(referralCodes.userId, input.userId),
        eq(referralCodes.isActive, true),
      ),
    )
    .limit(1);
  const code = codeRows[0];
  if (!code) {
    throw new NotFoundError("referral code not found");
  }

  const [invitedRows, activeRows, earnedRows, earnedEntRows, availableEntRows] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(referrals)
        .where(eq(referrals.referrerUserId, input.userId)),
      db
        .select({ value: count() })
        .from(referrals)
        .where(
          and(
            eq(referrals.referrerUserId, input.userId),
            eq(referrals.status, "activated"),
          ),
        ),
      db
        .select({
          total: sql<string>`coalesce(sum(${walletTransactions.amountMinor}), 0)::text`,
        })
        .from(walletTransactions)
        .where(
          and(
            eq(walletTransactions.userId, input.userId),
            inArray(walletTransactions.type, [
              "referral_inviter_reward",
              "referral_manual_credit",
            ]),
          ),
        ),
      db
        .select({ value: count() })
        .from(referralCaseEntitlements)
        .where(eq(referralCaseEntitlements.userId, input.userId)),
      db
        .select({ value: count() })
        .from(referralCaseEntitlements)
        .where(
          and(
            eq(referralCaseEntitlements.userId, input.userId),
            isNull(referralCaseEntitlements.consumedAt),
          ),
        ),
    ]);

  const realActive = Number(activeRows[0]?.value ?? 0);
  const manual = await sumManualReferralCredits(db, input.userId);
  const active = realActive + manual;
  const current = active % REFERRAL_CASE_MILESTONE_SIZE;

  return {
    referralUrl: buildReferralUrl(code.code, input.botUsername),
    token: code.code,
    stats: {
      invited: Number(invitedRows[0]?.value ?? 0),
      active,
      earnedAzc: asBigInt(earnedRows[0]?.total ?? "0").toString(),
    },
    caseProgress: {
      current,
      target: REFERRAL_CASE_MILESTONE_SIZE,
      availableCases: Number(availableEntRows[0]?.value ?? 0),
      totalCasesEarned: Number(earnedEntRows[0]?.value ?? 0),
    },
  };
}

export type ReferralListItem = {
  id: string;
  status: "attributed" | "activated";
  statusLabel: string;
  username: string | null;
  publicId: string | null;
  avatarUrl: string | null;
  attributedAt: string;
  activatedAt: string | null;
};

export async function listReferralsForUser(
  db: GiftbotDb,
  input: {
    userId: string;
    limit?: number;
    cursor?: ProfileListCursor;
  },
): Promise<{ items: ReferralListItem[]; nextCursor: string | null }> {
  const limit = clampProfileListLimit(input.limit);
  const filters = [eq(referrals.referrerUserId, input.userId)];
  if (input.cursor) {
    filters.push(
      sql`(${referrals.attributedAt}, ${referrals.id}) < (${new Date(input.cursor.createdAt)}::timestamptz, ${input.cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select({
      referral: referrals,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
      publicId: users.publicId,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.refereeUserId))
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, referrals.refereeUserId),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(and(...filters))
    .orderBy(desc(referrals.attributedAt), desc(referrals.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const extra = rows[limit];
  return {
    items: page.map((row) => {
      const status =
        row.referral.status === "activated" ? "activated" : "attributed";
      return {
        id: row.referral.id,
        status,
        statusLabel: status === "activated" ? "Активен" : "Приглашён",
        username: row.username,
        publicId: row.publicId,
        avatarUrl: publicAvatarUrl(row.photoUrl),
        attributedAt: row.referral.attributedAt.toISOString(),
        activatedAt: row.referral.activatedAt
          ? row.referral.activatedAt.toISOString()
          : null,
      };
    }),
    nextCursor: extra
      ? encodeProfileCursor({
          createdAt: extra.referral.attributedAt.toISOString(),
          id: extra.referral.id,
        })
      : null,
  };
}

export type ReferralLeaderboardEntry = {
  rank: number;
  /** Internal id for domain/tests; API responses must omit this field. */
  userId: string;
  username: string | null;
  displayName: string | null;
  publicId: string | null;
  avatarUrl: string | null;
  activeReferrals: number;
  isYou: boolean;
};

export type ReferralLeaderboardResult = {
  items: ReferralLeaderboardEntry[];
  self: ReferralLeaderboardEntry | null;
  serverTime: string;
};

/**
 * Referral TOP100 by activated referral count only (status = activated).
 * Users with 0 activated referrals are omitted from TOP100 (only positive counts).
 * Self is always returned with exact global rank among referrers who have ≥1
 * activated referral; a user with 0 activated ranks after all positive counts
 * (exact dense rank via the same ordering).
 *
 * Sort: active_count DESC, users.created_at ASC, users.id ASC.
 */

const REFERRAL_CACHE_TTL_MS = 10_000;

type CachedReferralTop = {
  at: number;
  rows: Array<{
    userId: string;
    activeCount: number;
    publicId: string | null;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
  }>;
};

let cachedReferralTop: CachedReferralTop | null = null;
let referralTopInflight: Promise<CachedReferralTop["rows"]> | null = null;

export function invalidateReferralLeaderboardCache(): void {
  cachedReferralTop = null;
  referralTopInflight = null;
}

async function loadReferralTop100(
  db: GiftbotDb,
): Promise<CachedReferralTop["rows"]> {
  const now = Date.now();
  if (cachedReferralTop && now - cachedReferralTop.at < REFERRAL_CACHE_TTL_MS) {
    return cachedReferralTop.rows;
  }
  if (referralTopInflight) {
    return referralTopInflight;
  }
  referralTopInflight = (async () => {
    const ranked = await db.execute<{
      user_id: string;
      active_count: string;
      public_id: string | null;
      display_name: string | null;
      username: string | null;
      photo_url: string | null;
    }>(sql`
    with counts as (
      select
        r.referrer_user_id as user_id,
        count(*)::int as active_count
      from referrals r
      where r.status = 'activated'
      group by r.referrer_user_id
    )
    select
      c.user_id,
      c.active_count::text as active_count,
      u.public_id,
      u.display_name,
      t.username,
      t.photo_url
    from counts c
    inner join users u on u.id = c.user_id and u.status = 'active'
    left join telegram_accounts t
      on t.user_id = c.user_id and t.is_active = true
    order by c.active_count desc, u.created_at asc, u.id asc
    limit 100
  `);
    const rows = ranked.map((row) => ({
      userId: row.user_id,
      activeCount: Number(row.active_count),
      publicId: row.public_id,
      displayName: row.display_name,
      username: row.username,
      avatarUrl: publicAvatarUrl(row.photo_url),
    }));
    cachedReferralTop = { at: Date.now(), rows };
    return rows;
  })().finally(() => {
    referralTopInflight = null;
  });
  return referralTopInflight;
}

export async function listReferralLeaderboard(
  db: GiftbotDb,
  input: { userId: string; limit?: number } = { userId: "" },
): Promise<ReferralLeaderboardResult> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
  const serverTime = new Date().toISOString();

  const top = await loadReferralTop100(db);
  const items: ReferralLeaderboardEntry[] = top.slice(0, limit).map((row, index) => ({
    rank: index + 1,
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    publicId: row.publicId,
    activeReferrals: row.activeCount,
    avatarUrl: row.avatarUrl,
    isYou: row.userId === input.userId,
  }));

  const selfInTop = items.find((row) => row.isYou) ?? null;
  if (selfInTop || !input.userId) {
    return { items, self: selfInTop, serverTime };
  }

  const selfCountRows = await db
    .select({ value: count() })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerUserId, input.userId),
        eq(referrals.status, "activated"),
      ),
    );
  const selfActive = Number(selfCountRows[0]?.value ?? 0);

  const aheadRows = await db.execute<{ ahead: string }>(sql`
    with counts as (
      select
        r.referrer_user_id as user_id,
        count(*)::int as active_count
      from referrals r
      where r.status = 'activated'
      group by r.referrer_user_id
    ),
    self_row as (
      select
        coalesce(
          (select active_count from counts where user_id = ${input.userId}),
          0
        ) as active_count,
        u.created_at,
        u.id as user_id
      from users u
      where u.id = ${input.userId}
      limit 1
    )
    select count(*)::text as ahead
    from counts c
    inner join users u on u.id = c.user_id and u.status = 'active'
    cross join self_row s
    where
      c.active_count > s.active_count
      or (
        c.active_count = s.active_count
        and (
          u.created_at < s.created_at
          or (u.created_at = s.created_at and u.id < s.user_id)
        )
      )
  `);

  const userRows = await db
    .select({
      publicId: users.publicId,
      displayName: users.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
    })
    .from(users)
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, users.id),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .where(eq(users.id, input.userId))
    .limit(1);

  const self: ReferralLeaderboardEntry = {
    rank: Number(aheadRows[0]?.ahead ?? 0) + 1,
    userId: input.userId,
    username: userRows[0]?.username ?? null,
    displayName: userRows[0]?.displayName ?? null,
    publicId: userRows[0]?.publicId ?? null,
    activeReferrals: selfActive,
    avatarUrl: publicAvatarUrl(userRows[0]?.photoUrl),
    isYou: true,
  };

  return { items, self, serverTime };
}

export async function countAvailableReferralCases(
  db: GiftbotDb | GiftbotTx,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(referralCaseEntitlements)
    .where(
      and(
        eq(referralCaseEntitlements.userId, userId),
        isNull(referralCaseEntitlements.consumedAt),
      ),
    );
  return Number(rows[0]?.value ?? 0);
}

/** Dev/test helper: create synthetic referees and activate via Kick link path. */
export async function seedActivatedReferralsForTests(
  db: GiftbotDb,
  input: {
    referrerUserId: string;
    count: number;
    provision: () => Promise<{ userId: string; referralCode: string }>;
    linkKick: (userId: string, kickUserId: string) => Promise<void>;
  },
): Promise<ActivateReferralResult[]> {
  const results: ActivateReferralResult[] = [];
  const codeRows = await db
    .select()
    .from(referralCodes)
    .where(
      and(
        eq(referralCodes.userId, input.referrerUserId),
        eq(referralCodes.isActive, true),
      ),
    )
    .limit(1);
  const code = codeRows[0];
  if (!code) {
    throw new NotFoundError("referral code not found");
  }
  for (let i = 0; i < input.count; i += 1) {
    const referee = await input.provision();
    await attributeReferral(db, {
      refereeUserId: referee.userId,
      code: code.code,
    });
    await input.linkKick(referee.userId, `dev-kick-${referee.userId}`);
    results.push(await onKickAccountLinked(db, referee.userId));
  }
  return results;
}
