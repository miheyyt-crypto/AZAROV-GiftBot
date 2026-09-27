import { createDb } from "@giftbot/db";
import { kickAccounts, telegramAccounts, walletTransactions } from "@giftbot/db/schema";
import { normalizeHttpsAvatarUrl } from "@giftbot/domain";
import { and, eq, sql } from "drizzle-orm";
import {
  kickUserIdOf,
  telegramIdOf,
  type FrozenV1Store,
} from "./store.js";

export type AvatarBackfillCounts = {
  telegramMatched: number;
  telegramAvatarAvailable: number;
  telegramUpdated: number;
  kickMatched: number;
  kickAvatarAvailable: number;
  kickUpdated: number;
  missingIdentities: number;
  walletBalancesUnchanged: true;
  walletTransactionsUnchanged: true;
};

export type AvatarBackfillReport = {
  dryRun: boolean;
  storeSha256: string;
  counts: AvatarBackfillCounts;
};

export type AvatarBackfillFlags = {
  apply: boolean;
  confirmApply: boolean;
  databaseUrl: string;
};

export async function runAvatarBackfill(input: {
  store: FrozenV1Store;
  flags: AvatarBackfillFlags;
}): Promise<AvatarBackfillReport> {
  if (input.flags.apply && !input.flags.confirmApply) {
    throw new Error("refusing apply without --confirm-apply");
  }
  const dryRun = !input.flags.apply;
  const handle = createDb(input.flags.databaseUrl);
  const counts: AvatarBackfillCounts = {
    telegramMatched: 0,
    telegramAvatarAvailable: 0,
    telegramUpdated: 0,
    kickMatched: 0,
    kickAvatarAvailable: 0,
    kickUpdated: 0,
    missingIdentities: 0,
    walletBalancesUnchanged: true,
    walletTransactionsUnchanged: true,
  };

  try {
    const txCountBefore = (
      await handle.db.select({ value: sql<number>`count(*)::int` }).from(walletTransactions)
    )[0]?.value ?? 0;

    for (const user of Object.values(input.store.users)) {
      const telegramId = telegramIdOf(user);
      if (telegramId === undefined) {
        counts.missingIdentities += 1;
        continue;
      }
      const accounts = await handle.db
        .select()
        .from(telegramAccounts)
        .where(eq(telegramAccounts.telegramUserId, telegramId))
        .limit(1);
      const account = accounts[0];
      if (!account) {
        counts.missingIdentities += 1;
        continue;
      }
      counts.telegramMatched += 1;

      const telegramPhoto = normalizeHttpsAvatarUrl(
        user.photoUrl ?? user.photo_url,
      );
      if (telegramPhoto) {
        counts.telegramAvatarAvailable += 1;
        if (account.photoUrl !== telegramPhoto) {
          counts.telegramUpdated += 1;
          if (!dryRun) {
            await handle.db
              .update(telegramAccounts)
              .set({ photoUrl: telegramPhoto })
              .where(eq(telegramAccounts.id, account.id));
          }
        }
      }

      const kickRows = await handle.db
        .select()
        .from(kickAccounts)
        .where(
          and(eq(kickAccounts.userId, account.userId), eq(kickAccounts.status, "active")),
        )
        .limit(1);
      const kick = kickRows[0];
      if (!kick) {
        continue;
      }
      counts.kickMatched += 1;
      const storeKickId = kickUserIdOf(user);
      const storeKick = storeKickId
        ? input.store.kickAccounts[storeKickId]
        : input.store.kickAccounts[kick.kickUserId];
      const kickPhoto = normalizeHttpsAvatarUrl(
        user.kickAvatarUrl ??
          user.kick_avatar_url ??
          storeKick?.avatarUrl ??
          storeKick?.avatar_url,
      );
      if (kickPhoto) {
        counts.kickAvatarAvailable += 1;
        if (kick.avatarUrl !== kickPhoto) {
          counts.kickUpdated += 1;
          if (!dryRun) {
            await handle.db
              .update(kickAccounts)
              .set({ avatarUrl: kickPhoto })
              .where(eq(kickAccounts.id, kick.id));
          }
        }
      }
    }

    const txCountAfter = (
      await handle.db.select({ value: sql<number>`count(*)::int` }).from(walletTransactions)
    )[0]?.value ?? 0;
    if (txCountAfter !== txCountBefore) {
      throw new Error("avatar backfill must not write wallet_transactions");
    }
  } finally {
    await handle.sql.end({ timeout: 5 });
  }

  return {
    dryRun,
    storeSha256: input.store.sha256,
    counts,
  };
}
