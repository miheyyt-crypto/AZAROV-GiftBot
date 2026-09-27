import type { AuthDatabase } from "@giftbot/auth";
import { wallets } from "@giftbot/db/schema";
import { asBigInt } from "@giftbot/domain";
import { eq } from "drizzle-orm";

/** Read-only wallet snapshot for mutation DTOs. Does not call Wallet.apply. */
export async function readAzcBalanceString(
  db: AuthDatabase,
  userId: string,
): Promise<string> {
  const rows = await db
    .select({ balanceMinor: wallets.balanceMinor })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return asBigInt(rows[0]?.balanceMinor ?? 0n).toString();
}

export async function withNewBalanceAzc<T extends Record<string, unknown>>(
  db: AuthDatabase,
  userId: string,
  body: T,
): Promise<T & { newBalanceAzc: string }> {
  return {
    ...body,
    newBalanceAzc: await readAzcBalanceString(db, userId),
  };
}
