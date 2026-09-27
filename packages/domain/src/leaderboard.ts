import { telegramAccounts, users, wallets } from "@giftbot/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { GiftbotDb } from "./db.js";
import { publicAvatarUrl } from "./https-url.js";
import { asBigInt } from "./money.js";

export type BalanceLeaderboardEntry = {
  rank: number;
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  balanceAzc: string;
  isYou: boolean;
};

export type BalanceLeaderboardResult = {
  items: BalanceLeaderboardEntry[];
  self: BalanceLeaderboardEntry | null;
  serverTime: string;
};

/**
 * Balance leaderboard ranking (deterministic):
 * 1) wallets.balance_minor DESC (current available AZC)
 * 2) users.created_at ASC
 * 3) users.id ASC
 *
 * Eligible: active users with a wallet row.
 * TOP returns at most 100. Self outside TOP gets exact global rank.
 */

const CACHE_TTL_MS = 10_000;

type CachedTop = {
  at: number;
  rows: Array<{
    userId: string;
    publicId: string | null;
    displayName: string | null;
    username: string | null;
    avatarUrl: string | null;
    balanceAzc: string;
    rank: number;
  }>;
};

let cachedTop: CachedTop | null = null;
let topInflight: Promise<CachedTop["rows"]> | null = null;

export function invalidateBalanceLeaderboardCache(): void {
  cachedTop = null;
  topInflight = null;
}

function toEntry(
  row: CachedTop["rows"][number],
  viewerId: string,
): BalanceLeaderboardEntry {
  return {
    rank: row.rank,
    publicId: row.publicId,
    displayName: row.displayName,
    username: row.username,
    avatarUrl: row.avatarUrl,
    balanceAzc: row.balanceAzc,
    isYou: row.userId === viewerId,
  };
}

async function loadTop100(db: GiftbotDb): Promise<CachedTop["rows"]> {
  const now = Date.now();
  if (cachedTop && now - cachedTop.at < CACHE_TTL_MS) {
    return cachedTop.rows;
  }
  if (topInflight) {
    return topInflight;
  }

  topInflight = (async () => {
    const ranked = await db.execute<{
      user_id: string;
      public_id: string | null;
      display_name: string | null;
      username: string | null;
      photo_url: string | null;
      balance_minor: string;
      rank: string;
    }>(sql`
    select
      w.user_id,
      u.public_id,
      u.display_name,
      t.username,
      t.photo_url,
      w.balance_minor::text as balance_minor,
      row_number() over (
        order by w.balance_minor desc, u.created_at asc, u.id asc
      )::text as rank
    from wallets w
    inner join users u on u.id = w.user_id and u.status = 'active'
    left join telegram_accounts t
      on t.user_id = w.user_id and t.is_active = true
    order by w.balance_minor desc, u.created_at asc, u.id asc
    limit 100
  `);

    const rows = ranked.map((row) => ({
      userId: row.user_id,
      publicId: row.public_id,
      displayName: row.display_name,
      username: row.username,
      avatarUrl: publicAvatarUrl(row.photo_url),
      balanceAzc: asBigInt(row.balance_minor).toString(),
      rank: Number(row.rank),
    }));
    cachedTop = { at: Date.now(), rows };
    return rows;
  })().finally(() => {
    topInflight = null;
  });

  return topInflight;
}

export async function listBalanceLeaderboard(
  db: GiftbotDb,
  input: { userId: string; limit?: number },
): Promise<BalanceLeaderboardResult> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
  const topRows = await loadTop100(db);
  const items = topRows.slice(0, limit).map((row) => toEntry(row, input.userId));
  const selfInTop = items.find((row) => row.isYou) ?? null;

  if (selfInTop) {
    return {
      items,
      self: selfInTop,
      serverTime: new Date().toISOString(),
    };
  }

  const ahead = await db.execute<{ ahead: string }>(sql`
    with self_wallet as (
      select
        coalesce(w.balance_minor, 0) as balance_minor,
        u.created_at,
        u.id as user_id
      from users u
      left join wallets w on w.user_id = u.id
      where u.id = ${input.userId}
      limit 1
    )
    select count(*)::text as ahead
    from wallets w
    inner join users u on u.id = w.user_id and u.status = 'active'
    cross join self_wallet s
    where
      w.balance_minor > s.balance_minor
      or (
        w.balance_minor = s.balance_minor
        and (
          u.created_at < s.created_at
          or (u.created_at = s.created_at and u.id < s.user_id)
        )
      )
  `);

  const profile = await db
    .select({
      publicId: users.publicId,
      displayName: users.displayName,
      username: telegramAccounts.username,
      photoUrl: telegramAccounts.photoUrl,
      balance: wallets.balanceMinor,
    })
    .from(users)
    .leftJoin(
      telegramAccounts,
      and(
        eq(telegramAccounts.userId, users.id),
        eq(telegramAccounts.isActive, true),
      ),
    )
    .leftJoin(wallets, eq(wallets.userId, users.id))
    .where(eq(users.id, input.userId))
    .limit(1);

  const self: BalanceLeaderboardEntry = {
    rank: Number(ahead[0]?.ahead ?? 0) + 1,
    publicId: profile[0]?.publicId ?? null,
    displayName: profile[0]?.displayName ?? null,
    username: profile[0]?.username ?? null,
    avatarUrl: publicAvatarUrl(profile[0]?.photoUrl),
    balanceAzc: asBigInt(profile[0]?.balance ?? 0n).toString(),
    isYou: true,
  };

  return {
    items,
    self,
    serverTime: new Date().toISOString(),
  };
}
