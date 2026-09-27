import { referralCodes, users, wallets } from "@giftbot/db/schema";
import { randomBytes, randomUUID } from "node:crypto";
import type { GiftbotDb, GiftbotTx } from "./db.js";

export type ProvisionedUser = {
  userId: string;
  publicId: string;
  walletId: string;
  referralCode: string;
};

function newReferralCode(): string {
  return randomBytes(8).toString("hex");
}

export async function provisionUserIn(
  tx: GiftbotTx,
  input: { displayName?: string; locale?: string } = {},
): Promise<ProvisionedUser> {
    const createdUsers = await tx
      .insert(users)
      .values({
        publicId: randomUUID(),
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
      })
      .returning();
    const user = createdUsers[0];
    if (!user) {
      throw new Error("failed to create user");
    }

    const createdWallets = await tx
      .insert(wallets)
      .values({
        userId: user.id,
      })
      .returning();
    const wallet = createdWallets[0];
    if (!wallet) {
      throw new Error("failed to create wallet");
    }

    const createdCodes = await tx
      .insert(referralCodes)
      .values({
        userId: user.id,
        code: newReferralCode(),
      })
      .returning();
    const code = createdCodes[0];
    if (!code) {
      throw new Error("failed to create referral code");
    }

  return {
    userId: user.id,
    publicId: user.publicId,
    walletId: wallet.id,
    referralCode: code.code,
  };
}

export async function provisionUser(
  db: GiftbotDb,
  input: { displayName?: string; locale?: string } = {},
): Promise<ProvisionedUser> {
  return db.transaction((tx) => provisionUserIn(tx, input));
}
