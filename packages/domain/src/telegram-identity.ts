import { referralCodes, telegramAccounts, users, wallets } from "@giftbot/db/schema";
import { eq } from "drizzle-orm";
import type { GiftbotDb, GiftbotTx } from "./db.js";
import { DomainError } from "./errors.js";
import { normalizeHttpsAvatarUrl } from "./https-url.js";
import { provisionUserIn } from "./user.js";

export class UserBlockedError extends DomainError {
  readonly userId?: string;

  constructor(userId?: string) {
    super("USER_BLOCKED", "user is blocked or deleted");
    if (userId !== undefined) {
      this.userId = userId;
    }
  }
}

export type TelegramIdentityInput = {
  telegramUserId: bigint;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  isPremium?: boolean;
  photoUrl?: string;
};

export type IdentifiedTelegramUser = {
  userId: string;
  publicId: string;
  walletId: string;
  referralCode: string;
  status: "active" | "blocked" | "deleted";
  created: boolean;
};

export async function identifyTelegramUserIn(
  tx: GiftbotTx,
  input: TelegramIdentityInput,
): Promise<IdentifiedTelegramUser> {
    const existingAccounts = await tx
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.telegramUserId, input.telegramUserId))
      .limit(1);
    const account = existingAccounts[0];

    if (account) {
      const userRows = await tx
        .select()
        .from(users)
        .where(eq(users.id, account.userId))
        .limit(1);
      const user = userRows[0];
      if (!user || user.status !== "active") {
        throw new UserBlockedError(account.userId);
      }

      const photoUrl = telegramPhotoUrlPatch(input.photoUrl);
      await tx
        .update(telegramAccounts)
        .set({
          ...(input.username !== undefined ? { username: input.username } : {}),
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          ...(input.languageCode !== undefined
            ? { languageCode: input.languageCode }
            : {}),
          ...(input.isPremium !== undefined ? { isPremium: input.isPremium } : {}),
          ...(photoUrl !== undefined ? { photoUrl } : {}),
          lastSeenAt: new Date(),
          isActive: true,
        })
        .where(eq(telegramAccounts.id, account.id));

      const walletRows = await tx
        .select()
        .from(wallets)
        .where(eq(wallets.userId, user.id))
        .limit(1);
      const wallet = walletRows[0];
      const codeRows = await tx
        .select()
        .from(referralCodes)
        .where(eq(referralCodes.userId, user.id))
        .limit(1);
      const code = codeRows[0];
      if (!wallet || !code) {
        throw new Error("existing telegram user is missing wallet or referral code");
      }

      return {
        userId: user.id,
        publicId: user.publicId,
        walletId: wallet.id,
        referralCode: code.code,
        status: user.status,
        created: false,
      };
    }

    const provisioned = await provisionUserIn(tx, {
      ...(input.firstName ? { displayName: input.firstName } : {}),
      ...(input.languageCode ? { locale: input.languageCode } : {}),
    });

    const photoUrl = telegramPhotoUrlPatch(input.photoUrl);
    await tx.insert(telegramAccounts).values({
      userId: provisioned.userId,
      telegramUserId: input.telegramUserId,
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.languageCode !== undefined
        ? { languageCode: input.languageCode }
        : {}),
      ...(photoUrl !== undefined ? { photoUrl } : {}),
      isPremium: input.isPremium ?? false,
      lastSeenAt: new Date(),
      isActive: true,
    });

    return {
      ...provisioned,
      status: "active",
      created: true,
    };
}

export async function identifyTelegramUser(
  db: GiftbotDb,
  input: TelegramIdentityInput,
): Promise<IdentifiedTelegramUser> {
  return db.transaction((tx) => identifyTelegramUserIn(tx, input));
}

function telegramPhotoUrlPatch(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const normalized = normalizeHttpsAvatarUrl(raw);
  return normalized ?? undefined;
}
